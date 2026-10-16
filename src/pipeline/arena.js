// Leaderboard data from the official HF dataset lmarena-ai/leaderboard-dataset (spec §3.1).
import { getJson } from './http.js';

const BASE = 'https://datasets-server.huggingface.co';
const DATASET = 'lmarena-ai/leaderboard-dataset';
const PAGE = 100;
// datasets-server can take 15-20 s per filtered page; while re-indexing it answers 500/502 and even a
// spurious 422 "A query parameter is invalid" for the same query that succeeds a minute later.
const slowHttp = url => getJson(url, { timeoutMs: 90000, retries: 5, baseDelayMs: 5000, retryStatuses: [422, 429] });

export const HF_CONFIG = { off: 'text', on: 'text_style_control' };

function toRow(r) {
  return {
    model_name: r.model_name,
    organization: r.organization,
    license: r.license,
    rating: Number(r.rating),
    rating_lower: Number(r.rating_lower),
    rating_upper: Number(r.rating_upper),
    variance: Number(r.variance),
    vote_count: Number(r.vote_count),
    rank: Number(r.rank),
    category: r.category,
    leaderboard_publish_date: r.leaderboard_publish_date,
  };
}

async function filterAll(config, split, where, { orderby, http = slowHttp, maxPages = 200 } = {}) {
  const rows = [];
  for (let page = 0; page < maxPages; page++) {
    let url = `${BASE}/filter?dataset=${encodeURIComponent(DATASET)}&config=${config}&split=${split}` +
      `&where=${encodeURIComponent(where)}&offset=${page * PAGE}&length=${PAGE}`;
    if (orderby) url += `&orderby=${encodeURIComponent(orderby)}`;
    const j = await http(url);
    rows.push(...j.rows.map(x => toRow(x.row)));
    if (rows.length >= j.num_rows_total || j.rows.length < PAGE) break;
  }
  return rows;
}

// /rows is much faster than /filter. The latest split lists the overall category first,
// so page until overall rows stop; fall back to /filter if the layout ever changes.
export async function fetchLatest(config, { http = slowHttp, maxPages = 20 } = {}) {
  const rows = [];
  for (let page = 0; page < maxPages; page++) {
    const j = await http(`${BASE}/rows?dataset=${encodeURIComponent(DATASET)}&config=${config}&split=latest` +
      `&offset=${page * PAGE}&length=${PAGE}`);
    const overall = j.rows.map(x => toRow(x.row)).filter(r => r.category === 'overall');
    rows.push(...overall);
    if (rows.length && overall.length < j.rows.length) break;
    if (j.rows.length < PAGE) break;
  }
  const result = rows.length ? rows : await filterAll(config, 'latest', `"category"='overall'`, { http });
  return result.sort((a, b) => b.rating - a.rating);
}

export async function fetchHistory(config, sinceDate, maxRank = 20, { untilDate, ...opts } = {}) {
  let where = `"category"='overall' AND "rank"<=${maxRank} AND "leaderboard_publish_date">'${sinceDate}'`;
  if (untilDate) where += ` AND "leaderboard_publish_date"<='${untilDate}'`;
  return filterAll(config, 'full', where, { orderby: '"leaderboard_publish_date" ASC', ...opts });
}
