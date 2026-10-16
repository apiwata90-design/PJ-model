import test from 'node:test';
import assert from 'node:assert/strict';
import { explain } from '../src/core/explain.js';

test('explains leader, gap, trend and new-model risk in Thai', () => {
  const models = [
    { model_name: 'Gemini X', organization: 'google', rating: 1530, rating_lower: 1522, rating_upper: 1538 },
    { model_name: 'Gemini Y', organization: 'google', rating: 1520, rating_lower: 1512, rating_upper: 1528 },
    { model_name: 'Claude Z', organization: 'anthropic', rating: 1515, rating_lower: 1508, rating_upper: 1522 },
  ];
  const lines = explain({
    models, companyMap: { google: 'Google', anthropic: 'Anthropic' },
    sim: { n: 10000, companies: { Google: 0.7, Anthropic: 0.3 }, models: { 'Gemini X': 0.6, 'Anthropic · model ใหม่': 0.2 } },
    newModel: { Anthropic: { lambdaPerDay: 0.02, best: 1515 } }, hDays: 15, trend: { 'Gemini X': -0.5, 'Claude Z': 0.3 },
  });
  assert.ok(lines.length >= 4);
  const all = lines.join('\n');
  assert.match(all, /Gemini X/);
  assert.match(all, /Claude Z/); // runner-up comes from a different company
  assert.match(all, /15/);
  assert.match(all, /แคบลง/);
  assert.match(all, /model ใหม่/);
});

test('empty leaderboard does not throw', () => {
  assert.deepEqual(explain({ models: [], companyMap: {}, sim: { companies: {}, models: {} }, newModel: {}, hDays: 1, trend: {} }), ['ไม่มีข้อมูล leaderboard']);
});
