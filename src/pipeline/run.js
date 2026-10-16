// Orchestrator: fetch -> validate -> forecast -> edge -> risk -> write audit trail (spec §4, §8, §12).
// CLI: node src/pipeline/run.js [--if-final-hours] [--now=ISO]
import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { targetMonth, checkTimeUtc, hoursUntil, monthKey } from '../core/calendar.js';
import { fetchLatest, fetchHistory, HF_CONFIG } from './arena.js';
import { findEvent, parseEvent, fetchBook } from './polymarket.js';
import { validateLeaderboard, validateEvent } from './validate.js';
import { cacheMerge } from './history.js';
import { buildForecast, attachMarket, outcomesNeedingBooks } from './build.js';

export const defaultDeps = { fetchLatest, fetchHistory, findEvent, fetchBook };
const MARKETS = ['off', 'on'];

const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback);
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 1));

export function loadConfig(root) {
  const c = name => readJson(join(root, 'config', `${name}.json`), {});
  return { settings: c('settings'), calibration: c('calibration'), overrides: c('overrides'),
    companies: c('companies'), markets: c('markets') };
}

const trimBook = b => ({ bids: [...b.bids].sort((x, y) => y.price - x.price).slice(0, 10),
  asks: [...b.asks].sort((x, y) => x.price - y.price).slice(0, 10) });

async function withFallback(status, name, cacheFile, fetcher, validate) {
  try {
    const value = await fetcher();
    const v = validate ? validate(value) : { ok: true };
    if (!v.ok) throw new Error(v.errors.join('; '));
    writeJson(cacheFile, { savedAt: new Date().toISOString(), value });
    status[name] = { ok: true, stale: false };
    return value;
  } catch (err) {
    const cached = readJson(cacheFile, null);
    status[name] = { ok: false, stale: Boolean(cached), error: String(err.message ?? err).slice(0, 300), staleSince: cached?.savedAt ?? null };
    return cached?.value ?? null;
  }
}

export async function run({ now = new Date(), root, deps = defaultDeps, ifFinalHours = false, log = console.log } = {}) {
  const config = loadConfig(root);
  const { settings } = config;
  const target = targetMonth(now);
  const checkAt = checkTimeUtc(target.year, target.month);
  if (ifFinalHours && hoursUntil(now, checkAt) > settings.finalHours) {
    log(`skip: ${hoursUntil(now, checkAt).toFixed(1)} h to check, outside final ${settings.finalHours} h`);
    return null;
  }
  const dataDir = join(root, 'data');
  const cacheDir = join(dataDir, 'cache');
  mkdirSync(cacheDir, { recursive: true });
  const seed = Math.floor(now.getTime() / 1000) >>> 0;
  const status = {};
  const markets = {}, snapshots = {}, simInputs = {};

  for (const key of MARKETS) {
    const cfg = HF_CONFIG[key];
    const latest = await withFallback(status, `arena-${key}`, join(cacheDir, `last-good-arena-${key}.json`),
      () => deps.fetchLatest(cfg), validateLeaderboard);

    const histFile = join(cacheDir, `history-${cfg}.json`);
    let history = readJson(histFile, []);
    try {
      const since = history.at(-1)?.leaderboard_publish_date ??
        new Date(now.getTime() - settings.historyDays * 86400000).toISOString().slice(0, 10);
      history = cacheMerge(history, await deps.fetchHistory(cfg, since, settings.historyMaxRank));
      writeJson(histFile, history);
      status[`history-${key}`] = { ok: true, stale: false };
    } catch (err) {
      status[`history-${key}`] = { ok: false, stale: true, error: String(err.message ?? err).slice(0, 300) };
    }

    const event = await withFallback(status, `pm-${key}`, join(cacheDir, `last-good-pm-${key}-${monthKey(target)}.json`),
      async () => {
        const ev = await deps.findEvent(key, target, config.markets);
        if (!ev) throw new Error(`ไม่พบตลาด ${key} ของ ${monthKey(target)}`);
        return parseEvent(ev);
      }, validateEvent);

    if (!latest) {
      markets[key] = { key, error: 'ไม่มีข้อมูล leaderboard ที่ใช้ได้เลย' };
      continue;
    }
    let forecast = buildForecast({ key, latestRows: latest, historyRows: history, target, now, config, seed });
    const books = {};
    if (event) {
      for (const o of outcomesNeedingBooks(forecast, event, settings.bookMinProb)) {
        for (const token of [o.yesToken, o.noToken]) {
          try { books[token] = trimBook(await deps.fetchBook(token)); } catch { /* edge for this outcome is skipped */ }
        }
      }
    }
    forecast = attachMarket(forecast, event, books, config);
    markets[key] = forecast;
    simInputs[key] = forecast.simInputs;
    snapshots[key] = { arena: latest.slice(0, 50), pm: event ? { ...event, books } : null };
  }

  const out = {
    generated_at: now.toISOString(),
    seed,
    target,
    targetKey: monthKey(target),
    checkAt: checkAt.toISOString(),
    status: { sources: status, stale: Object.values(status).some(s => !s.ok) },
    markets, // keeps simInputs so the dashboard can re-run what-if scenarios
  };

  // Audit trail.
  const day = now.toISOString().slice(0, 10);
  const hhmm = now.toISOString().slice(11, 16).replace(':', '') + 'Z';
  const snapDir = join(dataDir, 'snapshots', day, hhmm);
  mkdirSync(snapDir, { recursive: true });
  for (const key of MARKETS) {
    if (snapshots[key]) {
      writeJson(join(snapDir, `arena-${key}.json`), snapshots[key].arena);
      writeJson(join(snapDir, `pm-${key}.json`), snapshots[key].pm);
    }
  }
  const { markets: _m, ...configForAudit } = config;
  writeJson(join(snapDir, 'inputs.json'), { generated_at: out.generated_at, seed, config: configForAudit, simInputs });
  writeJson(join(snapDir, 'forecast.json'), out);
  mkdirSync(join(dataDir, 'latest'), { recursive: true });
  writeJson(join(dataDir, 'latest', 'forecast.json'), out);

  mkdirSync(join(dataDir, 'history'), { recursive: true });
  const line = { t: out.generated_at, target: out.targetKey, markets: {} };
  for (const [k, f] of Object.entries(out.markets)) {
    if (!f.sim) continue;
    line.markets[k] = { ours: Object.fromEntries(Object.entries(f.sim.companies).slice(0, 8)), mid: f.market.mids ?? {} };
  }
  appendFileSync(join(dataDir, 'history', `${out.targetKey}.jsonl`), JSON.stringify(line) + '\n');
  writeJson(join(dataDir, 'history', 'index.json'),
    [...new Set([...readJson(join(dataDir, 'history', 'index.json'), []), out.targetKey])].sort());

  log(`forecast ${out.targetKey} written to ${snapDir}`);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const nowArg = args.find(a => a.startsWith('--now='));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  run({ root, now: nowArg ? new Date(nowArg.slice(6)) : new Date(), ifFinalHours: args.includes('--if-final-hours') })
    .catch(err => { console.error(err); process.exitCode = 1; });
}
