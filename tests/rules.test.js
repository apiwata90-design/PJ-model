import test from 'node:test';
import assert from 'node:assert/strict';
import { companyOf, eligible, resolveWinner } from '../src/core/rules.js';

const map = { google: 'Google', anthropic: 'Anthropic', openai: 'OpenAI' };
const row = (model_name, organization, rank, rating) => ({ model_name, organization, rank, rating });

test('companyOf maps case-insensitively and passes unknown orgs through', () => {
  assert.equal(companyOf('Google', map), 'Google');
  assert.equal(companyOf('newlab', map), 'newlab');
});

test('AutoEval models are excluded', () => {
  const rows = [row('auto-x', 'openai', 1, 1600), row('gem', 'google', 2, 1500)];
  const kept = eligible(rows, new Set(['auto-x']));
  assert.deepEqual(kept.map(r => r.model_name), ['gem']);
  assert.equal(resolveWinner(kept, map).company, 'Google');
});

test('rank tie is broken by higher rating', () => {
  const rows = [row('a', 'anthropic', 1, 1500.1), row('g', 'google', 1, 1500.2)];
  assert.equal(resolveWinner(rows, map).company, 'Google');
});

test('rank and rating tie is broken alphabetically by company', () => {
  const rows = [row('g', 'google', 1, 1500), row('a', 'anthropic', 1, 1500)];
  assert.equal(resolveWinner(rows, map).company, 'Anthropic');
});

test('better rank wins even with lower rating', () => {
  const rows = [row('a', 'anthropic', 2, 1510), row('g', 'google', 1, 1505)];
  assert.equal(resolveWinner(rows, map).model, 'g');
});

test('modelKey treats display names and ids as the same model', async () => {
  const { modelKey } = await import('../src/core/rules.js');
  assert.equal(modelKey('Claude Opus 4.6 (High)'), modelKey('claude-opus-4-6-high'));
  assert.equal(modelKey('Claude Opus 5.5 (High)'), modelKey('claude-opus-5.5-high'));
  assert.notEqual(modelKey('Claude Opus 5 (Max)'), modelKey('Claude Opus 5 (High)'));
});
