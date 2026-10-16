// Fill data/cache/history-<config>.json from HF, one 30-day window at a time.
// The cache is saved after every window, so a failure (HF is slow and flaky) loses at most one window:
// just run the script again and it resumes from the last cached publish date.
// Progress is appended to data/cache/warm.log.
import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { fetchHistory, HF_CONFIG } from '../src/pipeline/arena.js';
import { cacheMerge } from '../src/pipeline/history.js';

const DAY_MS = 86400000;
const settings = JSON.parse(readFileSync(new URL('../config/settings.json', import.meta.url)));
const logFile = new URL('../data/cache/warm.log', import.meta.url);
mkdirSync(new URL('../data/cache/', import.meta.url), { recursive: true });
const log = msg => { const line = `${new Date().toISOString()} ${msg}`; console.log(line); appendFileSync(logFile, line + '\n'); };

const today = new Date().toISOString().slice(0, 10);
const start = new Date(Date.now() - settings.historyDays * DAY_MS).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * DAY_MS).toISOString().slice(0, 10);

let failed = false;
for (const config of Object.values(HF_CONFIG)) {
  const file = new URL(`../data/cache/history-${config}.json`, import.meta.url);
  let rows = existsSync(file) ? JSON.parse(readFileSync(file)) : [];
  let from = rows.length ? rows.at(-1).leaderboard_publish_date : start;
  log(`${config}: start from ${from} (${rows.length} cached rows)`);
  while (from < today) {
    const until = addDays(from, 30) < today ? addDays(from, 30) : today;
    let got = null;
    for (let attempt = 1; attempt <= 3 && got === null; attempt++) {
      try { got = await fetchHistory(config, from, settings.historyMaxRank, { untilDate: until }); }
      catch (err) { log(`${config}: ${from}..${until} attempt ${attempt} failed: ${String(err.message ?? err).slice(0, 160)}`); }
    }
    if (got === null) { failed = true; break; }
    rows = cacheMerge(rows, got);
    writeFileSync(file, JSON.stringify(rows));
    log(`${config}: ${from}..${until} +${got.length} rows (total ${rows.length})`);
    from = until;
  }
  if (failed) break;
}
log(failed ? 'STOPPED — run again to resume' : 'DONE');
process.exitCode = failed ? 1 : 0;
