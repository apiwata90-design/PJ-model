import test from 'node:test';
import assert from 'node:assert/strict';
import { backtest, brier, pastMonths } from '../src/pipeline/backtest.js';

const companies = { google: 'Google', anthropic: 'Anthropic', openai: 'OpenAI' };
const settings = { nSims: 500, window: 60, historyMaxRank: 20, rates: { lookbackDays: 365, topN: 10, priorPerDay: 0 },
  deltas: { lookbackDays: 730, topN: 10 }, driftDays: 14, lagDays: 1, chartDays: 30 };
const config = { settings, companies, calibration: { k: 1, sigmaFloor: 2, driftShrink: 0.5 }, overrides: {}, markets: {} };
const r = (date, model_name, organization, rating, rank) =>
  ({ leaderboard_publish_date: date, model_name, organization, rating, rank, variance: 9, rating_lower: rating - 6, rating_upper: rating + 6, vote_count: 9000 });

const dates = ['2026-09-01', '2026-09-08', '2026-09-14', '2026-09-20', '2026-09-26', '2026-09-29'];

test('brier score', () => {
  assert.equal(brier({ A: 1 }, 'A'), 0);
  assert.equal(brier({ A: 1 }, 'B'), 2);
  assert.equal(brier({ A: 0.5, B: 0.5 }, 'A'), 0.5);
});

test('pastMonths lists completed months oldest first', () => {
  assert.deepEqual(pastMonths(new Date('2026-10-16T00:00:00Z'), 2), [{ year: 2026, month: 8 }, { year: 2026, month: 9 }]);
});

test('dominant leader all month gives brier near 0', () => {
  const rows = dates.flatMap(d => [r(d, 'g', 'google', 1600, 1), r(d, 'a', 'anthropic', 1500, 2)]);
  const res = backtest({ historyRows: rows, config, months: [{ year: 2026, month: 9 }], n: 500 });
  assert.equal(res.n, 4);
  assert.ok(res.brier < 0.01, String(res.brier));
  assert.equal(res.hitRate, 1);
});

test('no look-ahead: a model published after the checkpoint is not seen', () => {
  const rows = dates.flatMap(d => [r(d, 'g', 'google', 1500, 1), r(d, 'a', 'anthropic', 1490, 2)]);
  rows.push(r('2026-09-26', 'o', 'openai', 1700, 1), r('2026-09-29', 'o', 'openai', 1700, 1));
  const res = backtest({ historyRows: rows, config, months: [{ year: 2026, month: 9 }], checkpoints: [15, 1], n: 500 });
  const early = res.rows.find(x => x.h === 15);
  const late = res.rows.find(x => x.h === 1);
  assert.equal(early.actual, 'OpenAI');
  assert.ok(early.asOf < '2026-09-26');
  assert.equal(early.probs.OpenAI ?? 0, 0, 'checkpoint 15 days out cannot know about o');
  assert.ok(late.probs.OpenAI > 0.99);
});
