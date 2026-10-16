// Statistics from leaderboard history used by the simulation (spec §5).
// Every function takes `asOf` and ignores rows published after it, so backtests cannot see the future.
import { companyOf } from '../core/rules.js';

const DAY_MS = 86400000;
const toDay = d => new Date(d + 'T00:00:00Z').getTime() / DAY_MS;

export function cacheMerge(oldRows, newRows) {
  const byKey = new Map();
  for (const r of [...oldRows, ...newRows]) byKey.set(`${r.leaderboard_publish_date}|${r.model_name}`, r);
  return [...byKey.values()].sort((a, b) =>
    a.leaderboard_publish_date.localeCompare(b.leaderboard_publish_date) || b.rating - a.rating);
}

export function upTo(rows, asOf) {
  return rows.filter(r => r.leaderboard_publish_date <= asOf);
}

export function publishDates(rows) {
  return [...new Set(rows.map(r => r.leaderboard_publish_date))].sort();
}

export function snapshotAt(rows, date) {
  return rows.filter(r => r.leaderboard_publish_date === date).sort((a, b) => b.rating - a.rating);
}

// Debuts: first publish where a model appears in the (rank-limited) history, excluding the first date we have.
function debuts(rows, asOf, topN) {
  const seen = new Map();
  const sorted = upTo(rows, asOf).sort((a, b) => a.leaderboard_publish_date.localeCompare(b.leaderboard_publish_date));
  const firstDate = sorted[0]?.leaderboard_publish_date;
  for (const r of sorted) if (!seen.has(r.model_name)) seen.set(r.model_name, r);
  return [...seen.values()].filter(r => r.leaderboard_publish_date !== firstDate && r.rank <= topN);
}

function bestByCompany(snapshot, companyMap) {
  const best = {};
  for (const r of snapshot) {
    const c = companyOf(r.organization, companyMap);
    if (!(c in best) || r.rating > best[c]) best[c] = r.rating;
  }
  return best;
}

export function newModelRates(rows, asOf, companyMap, { lookbackDays = 365, topN = 10, priorPerDay = 0.2 / 365 } = {}) {
  const dates = publishDates(upTo(rows, asOf));
  const best = bestByCompany(snapshotAt(rows, dates.at(-1)), companyMap);
  const from = toDay(asOf) - lookbackDays;
  const counts = {};
  for (const d of debuts(rows, asOf, topN)) {
    if (toDay(d.leaderboard_publish_date) < from) continue;
    const c = companyOf(d.organization, companyMap);
    counts[c] = (counts[c] || 0) + 1;
  }
  const out = {};
  for (const c of new Set([...Object.keys(best), ...Object.keys(counts)])) {
    out[c] = { lambdaPerDay: (counts[c] || 0) / lookbackDays + priorPerDay, best: best[c] ?? null };
  }
  return out;
}

export function debutDeltas(rows, asOf, companyMap, { lookbackDays = 730, topN = 10 } = {}) {
  const dates = publishDates(upTo(rows, asOf));
  const from = toDay(asOf) - lookbackDays;
  const deltas = [];
  for (const d of debuts(rows, asOf, topN)) {
    if (toDay(d.leaderboard_publish_date) < from) continue;
    const prev = dates[dates.indexOf(d.leaderboard_publish_date) - 1];
    if (!prev) continue;
    const snap = snapshotAt(rows, prev);
    const c = companyOf(d.organization, companyMap);
    const prevBest = bestByCompany(snap, companyMap)[c] ?? Math.min(...snap.map(r => r.rating));
    deltas.push(d.rating - prevBest);
  }
  return deltas;
}

export function driftPerDay(rows, asOf, { days = 14 } = {}) {
  const end = toDay(asOf);
  const pts = {};
  for (const r of upTo(rows, asOf)) {
    const t = toDay(r.leaderboard_publish_date);
    if (t <= end - days) continue;
    (pts[r.model_name] ||= []).push([t, r.rating]);
  }
  const out = {};
  for (const [name, p] of Object.entries(pts)) {
    if (p.length < 3) continue;
    const mx = p.reduce((a, [x]) => a + x, 0) / p.length;
    const my = p.reduce((a, [, y]) => a + y, 0) / p.length;
    const sxx = p.reduce((a, [x]) => a + (x - mx) ** 2, 0);
    if (sxx === 0) continue;
    out[name] = p.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0) / sxx;
  }
  return out;
}
