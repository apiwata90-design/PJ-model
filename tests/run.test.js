import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/pipeline/run.js';
import { simulate } from '../src/core/simulate.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
const pmFixture = JSON.parse(readFileSync(new URL('./fixtures/pm-event.json', import.meta.url)));

function tmpRoot() {
  const root = mkdtempSync(join(tmpdir(), 'arena-run-'));
  mkdirSync(join(root, 'config'));
  cpSync(join(repo, 'config'), join(root, 'config'), { recursive: true });
  return root;
}

const row = (model_name, organization, rating, rank, date = '2026-10-15') => ({
  model_name, organization, rating, rating_lower: rating - 8, rating_upper: rating + 8, variance: 16,
  vote_count: 9000, rank, category: 'overall', leaderboard_publish_date: date, license: 'Proprietary',
});
const latest = [row('Gemini A', 'google', 1532, 1), row('Claude B', 'anthropic', 1516, 2), row('Claude C', 'anthropic', 1511, 3),
  row('GPT D', 'openai', 1490, 4), row('Muse E', 'meta', 1488, 5), row('Grok F', 'xai', 1470, 6)];

function deps({ pmFails = false, calls = [] } = {}) {
  return {
    fetchLatest: async () => latest,
    fetchHistory: async () => [],
    findEvent: async (key, target) => {
      calls.push({ key, target });
      if (pmFails) throw new Error('network down');
      return pmFixture;
    },
    fetchBook: async () => ({ bids: [{ price: 0.5, size: 1000 }], asks: [{ price: 0.52, size: 1000 }] }),
  };
}
const quiet = () => {};

test('writes latest forecast, snapshot files and history line', async () => {
  const root = tmpRoot();
  const now = new Date('2026-10-16T12:00:00Z');
  const out = await run({ root, now, deps: deps(), log: quiet });
  assert.equal(out.targetKey, '2026-10');
  assert.ok(out.markets.off.sim.companies.Google > 0.5);
  assert.ok(out.markets.off.market.found);
  assert.ok(out.markets.off.edges.Google, 'edge computed for Google');
  assert.ok(existsSync(join(root, 'data', 'latest', 'forecast.json')));
  const snap = join(root, 'data', 'snapshots', '2026-10-16', '1200Z');
  assert.deepEqual(readdirSync(snap).sort(), ['arena-off.json', 'arena-on.json', 'forecast.json', 'inputs.json', 'pm-off.json', 'pm-on.json']);
  const hist = readFileSync(join(root, 'data', 'history', '2026-10.jsonl'), 'utf8').trim().split('\n');
  assert.equal(hist.length, 1);
});

test('replaying inputs.json reproduces the exact simulation', async () => {
  const root = tmpRoot();
  const out = await run({ root, now: new Date('2026-10-16T12:00:00Z'), deps: deps(), log: quiet });
  const inputs = JSON.parse(readFileSync(join(root, 'data', 'snapshots', '2026-10-16', '1200Z', 'inputs.json')));
  assert.deepEqual(simulate(inputs.simInputs.off), out.markets.off.sim);
});

test('polymarket failure still writes a forecast, flagged stale/danger', async () => {
  const root = tmpRoot();
  const out = await run({ root, now: new Date('2026-10-16T12:00:00Z'), deps: deps({ pmFails: true }), log: quiet });
  assert.ok(out.markets.off.sim.companies.Google > 0.5);
  assert.equal(out.markets.off.market.found, false);
  assert.equal(out.markets.off.risks.find(r => r.id === 'market-missing').level, 'danger');
  assert.equal(out.status.sources['pm-off'].ok, false);
  assert.equal(out.status.stale, true);
});

test('after the October check the pipeline targets November', async () => {
  const calls = [];
  const out = await run({ root: tmpRoot(), now: new Date('2026-10-31T16:30:00Z'), deps: deps({ calls }), log: quiet });
  assert.equal(out.targetKey, '2026-11');
  assert.deepEqual(calls[0].target, { year: 2026, month: 11 });
});

test('--if-final-hours skips outside the last 72 hours', async () => {
  const out = await run({ root: tmpRoot(), now: new Date('2026-10-16T12:00:00Z'), deps: deps(), ifFinalHours: true, log: quiet });
  assert.equal(out, null);
});

test('missing history falls back to the delta prior and says so', async () => {
  const out = await run({ root: tmpRoot(), now: new Date('2026-10-16T12:00:00Z'), deps: deps(), log: quiet });
  assert.equal(out.markets.off.simInputs.deltaSource, 'prior');
  assert.ok(out.markets.off.simInputs.debutDeltas.length >= 5);
  assert.ok(out.markets.off.reasons.some(r => r.includes('deltaPrior')));
});
