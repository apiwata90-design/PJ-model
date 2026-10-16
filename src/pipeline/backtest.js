// Backtest + calibration (spec §9): replay past months using only data published before each checkpoint.
// CLI: node src/pipeline/backtest.js [--months=24] [--market]
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { simulate } from '../core/simulate.js';
import { resolveWinner } from '../core/rules.js';
import { checkTimeUtc, targetMonth } from '../core/calendar.js';
import { publishDates, snapshotAt, upTo } from './history.js';
import { simInputsFor } from './build.js';
import { HF_CONFIG } from './arena.js';
import { findEvent, parseEvent, priceHistory } from './polymarket.js';
import { loadConfig } from './run.js';

const DAY_MS = 86400000;
const dayOf = d => d.toISOString().slice(0, 10);

export function brier(probs, actual) {
  const keys = new Set([...Object.keys(probs), actual]);
  let s = 0;
  for (const k of keys) s += ((probs[k] ?? 0) - (k === actual ? 1 : 0)) ** 2;
  return s;
}

export function pastMonths(now, count) {
  let { year, month } = targetMonth(now);
  const out = [];
  for (let i = 0; i < count; i++) {
    month -= 1;
    if (month === 0) { month = 12; year -= 1; }
    out.unshift({ year, month });
  }
  return out;
}

export function backtest({ historyRows, config, months, checkpoints = [15, 7, 3, 1], params, n = 2000, seed = 1 }) {
  const dates = publishDates(historyRows);
  const cfg = {
    ...config,
    settings: { ...config.settings, nSims: n },
    calibration: { ...config.calibration, ...params },
    overrides: { autoEval: [], news: {} },
  };
  const rows = [];
  for (const target of months) {
    const checkAt = checkTimeUtc(target.year, target.month);
    const finalDate = dates.filter(d => d <= dayOf(checkAt)).at(-1);
    if (!finalDate) continue;
    const actual = resolveWinner(snapshotAt(historyRows, finalDate), config.companies)?.company;
    for (const h of checkpoints) {
      const now = new Date(checkAt.getTime() - h * DAY_MS);
      const asOf = dates.filter(d => d < dayOf(now)).at(-1); // a publish dated today may not be out yet
      if (!asOf) continue;
      const latestRows = snapshotAt(historyRows, asOf);
      const { inputs } = simInputsFor({ latestRows, historyRows: upTo(historyRows, asOf), target, now, config: cfg, seed });
      const sim = simulate(inputs);
      const leader = resolveWinner(latestRows, config.companies)?.company;
      rows.push({
        month: `${target.year}-${String(target.month).padStart(2, '0')}`, h, asOf, actual, leader,
        probs: sim.companies, brier: brier(sim.companies, actual),
        logLoss: -Math.log(Math.max(sim.companies[actual] ?? 0, 1e-4)),
        leaderBrier: brier({ [leader]: 1 }, actual),
      });
    }
  }
  return summarize(rows);
}

export function summarize(rows) {
  const mean = f => (rows.length ? rows.reduce((a, r) => a + f(r), 0) / rows.length : null);
  const bins = Array.from({ length: 10 }, (_, i) => ({ bin: i / 10, n: 0, sumP: 0, hits: 0 }));
  for (const r of rows) {
    for (const [c, p] of Object.entries(r.probs)) {
      const b = bins[Math.min(9, Math.floor(p * 10))];
      b.n++; b.sumP += p; b.hits += c === r.actual ? 1 : 0;
    }
  }
  return {
    rows,
    n: rows.length,
    brier: mean(r => r.brier),
    logLoss: mean(r => r.logLoss),
    hitRate: mean(r => (Object.keys(r.probs)[0] === r.actual ? 1 : 0)),
    leaderBrier: mean(r => r.leaderBrier),
    calibration: bins.filter(b => b.n).map(b => ({ bin: b.bin, n: b.n, meanP: b.sumP / b.n, freq: b.hits / b.n })),
  };
}

export function fitParams({ historyRows, config, months, grid = { k: [0.5, 0.75, 1, 1.5, 2, 3], sigmaFloor: [0, 2, 4, 8] }, n = 1000 }) {
  const half = Math.floor(months.length / 2);
  const train = months.slice(0, half), test = months.slice(half);
  let best = null;
  for (const k of grid.k) {
    for (const sigmaFloor of grid.sigmaFloor) {
      const r = backtest({ historyRows, config, months: train, params: { k, sigmaFloor }, n });
      if (r.brier !== null && (!best || r.brier < best.trainBrier)) best = { k, sigmaFloor, trainBrier: r.brier };
    }
  }
  const testChosen = backtest({ historyRows, config, months: test, params: { k: best.k, sigmaFloor: best.sigmaFloor }, n });
  const testDefault = backtest({ historyRows, config, months: test, params: { k: 1, sigmaFloor: 2 }, n });
  return { ...best, testBrier: testChosen.brier, testBrierDefault: testDefault.brier, trainMonths: train.length, testMonths: test.length };
}

// Market baseline: the YES price of each listed company at each checkpoint (best effort).
async function marketBaseline(key, rows, config) {
  const out = [];
  const byMonth = {};
  for (const r of rows) (byMonth[r.month] ||= []).push(r);
  for (const [month, mrows] of Object.entries(byMonth)) {
    const [year, m] = month.split('-').map(Number);
    let event;
    try { event = await findEvent(key, { year, month: m }, config.markets); } catch { event = null; }
    if (!event) continue;
    const parsed = parseEvent(event);
    for (const r of mrows) {
      const ts = Math.floor((checkTimeUtc(year, m).getTime() - r.h * DAY_MS) / 1000);
      const wanted = parsed.outcomes.filter(o => (r.probs[o.company] ?? 0) >= 0.01 || o.company === r.actual);
      const probs = {};
      for (const o of wanted) {
        try {
          const hist = await priceHistory(o.yesToken, ts - 6 * 3600, ts);
          if (hist.length) probs[o.company] = hist.at(-1).p;
        } catch { /* missing price -> company left out */ }
      }
      if (Object.keys(probs).length) out.push({ month, h: r.h, probs, brier: brier(probs, r.actual), oursBrier: r.brier });
    }
  }
  const mean = f => (out.length ? out.reduce((a, x) => a + f(x), 0) / out.length : null);
  return out.length ? { n: out.length, brier: mean(x => x.brier), oursBrierSame: mean(x => x.oursBrier), rows: out } : null;
}

async function main() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const args = process.argv.slice(2);
  const count = Number(args.find(a => a.startsWith('--months='))?.slice(9) ?? 24);
  const config = loadConfig(root);
  const months = pastMonths(new Date(), count);
  const report = { generated_at: new Date().toISOString(), months: count, markets: {} };
  const fits = [];
  for (const [key, cfg] of Object.entries(HF_CONFIG)) {
    const file = join(root, 'data', 'cache', `history-${cfg}.json`);
    if (!existsSync(file)) { console.log(`skip ${key}: no ${file} (run scripts/warm-history.js)`); continue; }
    const historyRows = JSON.parse(readFileSync(file, 'utf8'));
    const fit = fitParams({ historyRows, config, months });
    fits.push(fit);
    const result = backtest({ historyRows, config, months, params: { k: fit.k, sigmaFloor: fit.sigmaFloor } });
    const market = args.includes('--market') ? await marketBaseline(key, result.rows, config) : null;
    report.markets[key] = { fit, ...result, market };
    console.log(`${key}: brier ${result.brier?.toFixed(3)} (leader-only ${result.leaderBrier?.toFixed(3)}), hit ${(result.hitRate * 100).toFixed(0)}%, k=${fit.k} floor=${fit.sigmaFloor}` +
      (market ? `, market brier ${market.brier.toFixed(3)} vs ours ${market.oursBrierSame.toFixed(3)} on ${market.n}` : ''));
  }
  mkdirSync(join(root, 'data', 'backtest'), { recursive: true });
  writeFileSync(join(root, 'data', 'backtest', 'report.json'), JSON.stringify(report, null, 1));
  if (fits.length) {
    const avg = f => fits.reduce((a, x) => a + f(x), 0) / fits.length;
    const pick = (vals, target) => vals.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    const calibration = {
      k: pick([0.5, 0.75, 1, 1.5, 2, 3], avg(x => x.k)),
      sigmaFloor: pick([0, 2, 4, 8], avg(x => x.sigmaFloor)),
      driftShrink: config.calibration.driftShrink ?? 0.5,
      fittedAt: report.generated_at,
      note: `grid search on first half of ${count} months, both markets`,
    };
    writeFileSync(join(root, 'config', 'calibration.json'), JSON.stringify(calibration, null, 2) + '\n');
    console.log('calibration', calibration);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(err); process.exitCode = 1; });
}
