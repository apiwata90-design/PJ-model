import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, NEW_MODEL_SUFFIX } from '../src/core/simulate.js';

const companyMap = { google: 'Google', anthropic: 'Anthropic', openai: 'OpenAI' };
const params = { k: 1, sigmaFloor: 2, driftShrink: 0.5, window: 60 };
const base = (models, extra = {}) => ({
  models, companyMap, hDays: 10, n: 4000, seed: 1, params,
  newModel: {}, debutDeltas: [], overrides: {}, lagDays: 1, ...extra,
});
const m = (name, org, rating, variance = 16, drift = 0) => ({ name, org, rating, variance, drift });
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);

test('deterministic for the same seed', () => {
  const inp = base([m('g', 'google', 1500), m('a', 'anthropic', 1495)]);
  assert.deepEqual(simulate(inp), simulate(inp));
});

test('big lead with one day left is near certain', () => {
  const r = simulate(base([m('g', 'google', 1600), m('a', 'anthropic', 1500)], { hDays: 1 }));
  assert.ok(r.companies.Google > 0.99, JSON.stringify(r.companies));
});

test('two equal models split ~50/50', () => {
  const r = simulate(base([m('g', 'google', 1500), m('a', 'anthropic', 1500)], { n: 10000 }));
  assert.ok(Math.abs(r.companies.Google - 0.5) < 0.02, JSON.stringify(r.companies));
});

test('override with certain strong new model wins', () => {
  const r = simulate(base([m('g', 'google', 1500), m('a', 'anthropic', 1490), m('o', 'openai', 1450)], {
    newModel: { OpenAI: { lambdaPerDay: 0, best: 1450 } },
    overrides: { OpenAI: { prob: 1, delta: 120 } },
  }));
  assert.ok(r.companies.OpenAI > 0.97, JSON.stringify(r.companies));
  assert.ok(r.models['OpenAI' + NEW_MODEL_SUFFIX] > 0.97);
});

test('poisson new models use debut deltas and respect lag', () => {
  const inp = base([m('g', 'google', 1500), m('o', 'openai', 1450)], {
    newModel: { OpenAI: { lambdaPerDay: 5, best: 1450 } }, debutDeltas: [200],
  });
  assert.ok(simulate(inp).companies.OpenAI > 0.99);
  assert.ok((simulate({ ...inp, hDays: 0.9 }).companies.OpenAI ?? 0) < 0.05, 'no debut inside lag window');
});

test('models outside window are ignored and probabilities sum to 1', () => {
  const r = simulate(base([m('g', 'google', 1500), m('a', 'anthropic', 1300)]));
  assert.equal(r.models.a ?? 0, 0);
  assert.ok(Math.abs(sum(r.companies) - 1) < 1e-9);
  assert.ok(Math.abs(sum(r.models) - 1) < 1e-9);
});
