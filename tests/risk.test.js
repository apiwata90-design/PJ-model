import test from 'node:test';
import assert from 'node:assert/strict';
import { assessRisk } from '../src/core/risk.js';

const companyMap = { google: 'Google', anthropic: 'Anthropic' };
const mk = (name, org, rating, ci = 8, vote_count = 10000) =>
  ({ model_name: name, organization: org, rating, rating_lower: rating - ci, rating_upper: rating + ci, vote_count });
const ctx = (over = {}) => ({
  now: new Date('2026-10-16T12:00:00Z'), checkAt: new Date('2026-10-31T16:00:00Z'),
  publishDate: '2026-10-15', models: [mk('g', 'google', 1530), mk('a', 'anthropic', 1500)],
  companyMap, autoEval: new Set(), marketFound: true, settings: { lowVotes: 3000 }, ...over,
});
const level = (risks, id) => risks.find(r => r.id === id).level;

test('everything fine gives ok levels', () => {
  const r = assessRisk(ctx());
  for (const id of ['freshness', 'close-race', 'low-votes', 'dataset-lag', 'unknown-org', 'market-missing']) assert.equal(level(r, id), 'ok', id);
  assert.equal(level(r, 'autoeval'), 'warn'); // standing reminder: dataset has no AutoEval flag
});

test('stale leaderboard warns then dangers', () => {
  assert.equal(level(assessRisk(ctx({ publishDate: '2026-10-12' })), 'freshness'), 'warn');
  assert.equal(level(assessRisk(ctx({ publishDate: '2026-10-08' })), 'freshness'), 'danger');
});

test('close race between companies warns', () => {
  assert.equal(level(assessRisk(ctx({ models: [mk('g', 'google', 1505), mk('a', 'anthropic', 1500)] })), 'close-race'), 'warn');
});

test('low votes on the leader warns', () => {
  assert.equal(level(assessRisk(ctx({ models: [mk('g', 'google', 1530, 8, 900), mk('a', 'anthropic', 1500)] })), 'low-votes'), 'warn');
});

test('final 48h warns about dataset lag', () => {
  assert.equal(level(assessRisk(ctx({ now: new Date('2026-10-30T12:00:00Z') })), 'dataset-lag'), 'warn');
});

test('unknown org in top 10 and missing market', () => {
  const r = assessRisk(ctx({ models: [mk('g', 'google', 1530), mk('x', 'newlab', 1500)], marketFound: false }));
  assert.equal(level(r, 'unknown-org'), 'warn');
  assert.ok(r.find(x => x.id === 'unknown-org').text.includes('newlab'));
  assert.equal(level(r, 'market-missing'), 'danger');
});

test('autoeval-flagged model in top 5 is called out', () => {
  const r = assessRisk(ctx({ autoEval: new Set(['a']) }));
  assert.ok(r.find(x => x.id === 'autoeval').text.includes('a'));
});
