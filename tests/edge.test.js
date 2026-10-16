import test from 'node:test';
import assert from 'node:assert/strict';
import { takerFee, walkAsks, evaluateCompany } from '../src/core/edge.js';

const tech = { rate: 0.04, exponent: 1, takerOnly: true };

test('fee matches docs example (100 shares @0.50, rate 0.07 -> $1.75)', () => {
  assert.equal(Math.round(takerFee(100, 0.5, { rate: 0.07, exponent: 1 }) * 100) / 100, 1.75);
  assert.equal(takerFee(100, 0.5, null), 0);
});

test('walks several ask levels, fees included in spend', () => {
  const asks = [{ price: 0.5, size: 10 }, { price: 0.6, size: 10 }, { price: 0.7, size: 1000 }];
  const r = walkAsks(asks, 20, tech);
  assert.ok(r.complete);
  assert.ok(Math.abs(r.spentUsd - 20) < 1e-9);
  assert.ok(Math.abs(r.shares - 32.428) < 0.01, String(r.shares)); // 10 + 10 + 8.804/0.7084
  assert.ok(r.avgPrice > 0.6 && r.avgPrice < 0.7);
  assert.ok(r.feeUsd > 0);
});

test('book thinner than stake is incomplete; empty book fills nothing', () => {
  const r = walkAsks([{ price: 0.5, size: 10 }], 100, tech);
  assert.equal(r.complete, false);
  assert.ok(r.spentUsd < 6);
  const e = walkAsks([], 100, tech);
  assert.equal(e.shares, 0);
  assert.equal(e.avgPrice, null);
});

const book = (bid, ask) => ({ bids: [{ price: bid, size: 5000 }], asks: [{ price: ask, size: 5000 }] });

test('signals YES when our probability is well above an executable price', () => {
  const r = evaluateCompany({ pYes: 0.8, yes: book(0.59, 0.61), no: book(0.39, 0.41), schedule: tech, stakes: [100, 1000], threshold: 0.1 });
  assert.equal(r.signal, 'yes');
  assert.ok(Math.abs(r.mid - 0.6) < 1e-9);
  assert.ok(r.yes[0].ev > 0.25);
  assert.equal(r.yes.length, 2);
});

test('signals NO when our probability is well below the market', () => {
  const r = evaluateCompany({ pYes: 0.2, yes: book(0.49, 0.51), no: book(0.49, 0.51), schedule: tech, stakes: [100], threshold: 0.1 });
  assert.equal(r.signal, 'no');
});

test('no signal when the spread eats the edge', () => {
  const r = evaluateCompany({ pYes: 0.72, yes: { bids: [{ price: 0.6, size: 100 }], asks: [{ price: 0.75, size: 100 }] }, no: book(0.25, 0.4), schedule: tech, stakes: [100], threshold: 0.1 });
  assert.equal(r.signal, null);
});

test('missing books fall back to last price and never produce NaN', () => {
  const r = evaluateCompany({ pYes: 0.3, yes: { bids: [], asks: [] }, no: { bids: [], asks: [] }, lastPrice: 0.25, schedule: tech, stakes: [100], threshold: 0.1 });
  assert.equal(r.mid, 0.25);
  assert.equal(r.yes[0].ev, null);
  assert.equal(r.signal, null);
});
