import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, normal, poisson } from '../src/core/rng.js';

test('same seed gives same sequence', () => {
  const a = makeRng(42), b = makeRng(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

test('normal has mean ~0 and sd ~1', () => {
  const r = makeRng(1); const n = 20000; let s = 0, s2 = 0;
  for (let i = 0; i < n; i++) { const x = normal(r); s += x; s2 += x * x; }
  const mean = s / n, sd = Math.sqrt(s2 / n - mean * mean);
  assert.ok(Math.abs(mean) < 0.03, `mean ${mean}`);
  assert.ok(Math.abs(sd - 1) < 0.03, `sd ${sd}`);
});

test('poisson mean ~ lambda', () => {
  const r = makeRng(7); const n = 20000; let s = 0;
  for (let i = 0; i < n; i++) s += poisson(r, 2);
  assert.ok(Math.abs(s / n - 2) < 0.05);
  assert.equal(poisson(r, 0), 0);
});
