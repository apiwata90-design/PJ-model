import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheMerge, newModelRates, debutDeltas, driftPerDay, publishDates } from '../src/pipeline/history.js';
import { getJson } from '../src/pipeline/http.js';

const companyMap = { google: 'Google', anthropic: 'Anthropic', openai: 'OpenAI' };
const r = (date, model_name, organization, rating, rank) =>
  ({ leaderboard_publish_date: date, model_name, organization, rating, rank, variance: 9 });

// 6 publishes. g1/a1 exist from the start; a2 debuts 2026-03-10 (rank 1, +12 over a1);
// o-late debuts 2026-03-25, after the asOf used below.
const rows = [
  r('2026-03-01', 'g1', 'google', 1500, 1), r('2026-03-01', 'a1', 'anthropic', 1490, 2),
  r('2026-03-05', 'g1', 'google', 1499, 1), r('2026-03-05', 'a1', 'anthropic', 1491, 2),
  r('2026-03-10', 'a2', 'anthropic', 1503, 1), r('2026-03-10', 'g1', 'google', 1498, 2), r('2026-03-10', 'a1', 'anthropic', 1492, 3),
  r('2026-03-15', 'a2', 'anthropic', 1504, 1), r('2026-03-15', 'g1', 'google', 1497, 2), r('2026-03-15', 'a1', 'anthropic', 1492, 3),
  r('2026-03-20', 'a2', 'anthropic', 1505, 1), r('2026-03-20', 'g1', 'google', 1496, 2), r('2026-03-20', 'a1', 'anthropic', 1492, 3),
  r('2026-03-25', 'o-late', 'openai', 1600, 1),
];
const asOf = '2026-03-20';

test('cacheMerge dedupes by date+model, newer row wins', () => {
  const merged = cacheMerge(rows, [{ ...rows[0], rating: 1501 }]);
  assert.equal(merged.length, rows.length);
  assert.equal(merged.find(x => x.model_name === 'g1' && x.leaderboard_publish_date === '2026-03-01').rating, 1501);
  assert.deepEqual(publishDates(merged).slice(0, 2), ['2026-03-01', '2026-03-05']);
});

test('newModelRates counts debuts per company and ignores the future', () => {
  const rates = newModelRates(rows, asOf, companyMap, { lookbackDays: 10, priorPerDay: 0 });
  assert.equal(rates.Anthropic.lambdaPerDay, 1 / 10);
  assert.equal(rates.Google.lambdaPerDay, 0);
  assert.equal(rates.OpenAI, undefined, 'o-late is after asOf');
  assert.equal(rates.Anthropic.best, 1505);
  assert.equal(rates.Google.best, 1496);
});

test('rates use the available span when history is shorter than the lookback', () => {
  const rates = newModelRates(rows, asOf, companyMap, { lookbackDays: 365, priorPerDay: 0 });
  assert.equal(rates.Anthropic.lambdaPerDay, 1 / 19); // 2026-03-01 .. 2026-03-20
});

test('debutDeltas measures debut against the company best on the previous publish', () => {
  assert.deepEqual(debutDeltas(rows, asOf, companyMap), [1503 - 1491]);
});

test('driftPerDay gives slope over the window', () => {
  const d = driftPerDay(rows, asOf, { days: 14 });
  assert.ok(d.g1 < 0 && Math.abs(d.g1 + 0.2) < 1e-9, String(d.g1));
  assert.ok(d.a2 > 0);
  assert.equal(d['o-late'], undefined);
});

test('getJson retries server errors then succeeds', async () => {
  let calls = 0;
  const fake = async () => (++calls < 3
    ? { ok: false, status: 500, text: async () => '{"error":"the dataset index is loading"}' }
    : { ok: true, status: 200, text: async () => '{"rows":[]}' });
  assert.deepEqual(await getJson('x', { fetchImpl: fake, baseDelayMs: 1 }), { rows: [] });
  assert.equal(calls, 3);
});

test('getJson does not retry 404', async () => {
  let calls = 0;
  const fake = async () => { calls++; return { ok: false, status: 404, text: async () => 'nope' }; };
  await assert.rejects(getJson('x', { fetchImpl: fake, baseDelayMs: 1 }));
  assert.equal(calls, 1);
});
