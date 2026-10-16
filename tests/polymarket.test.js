import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEvent, slugFor, titleMatches, findEvent } from '../src/pipeline/polymarket.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/pm-event.json', import.meta.url)));

test('parseEvent decodes double-encoded arrays and fee schedule', () => {
  const p = parseEvent(fixture);
  const g = p.outcomes.find(o => o.company === 'Google');
  assert.ok(g.yesToken && g.noToken && g.yesToken !== g.noToken);
  assert.ok(g.yesPrice > 0 && g.yesPrice < 1);
  assert.equal(g.schedule.rate, 0.04);
  assert.match(p.description, /AutoEval/);
});

test('slugs and title matching for both markets', () => {
  assert.equal(slugFor('off', 10), 'which-company-has-the-best-ai-model-end-of-october');
  assert.equal(slugFor('on', 11), 'which-company-has-1-ai-model-end-of-november-style-control-on');
  assert.ok(titleMatches('off', 'Which company has the best AI model end of September?', 9));
  assert.ok(titleMatches('off', 'Which company has best AI model end of September?', 9));
  assert.ok(!titleMatches('off', 'Which company has second best AI model end of September?', 9));
  assert.ok(!titleMatches('off', 'Which company has the best Code Arena WebDev AI model end of September?', 9));
  assert.ok(titleMatches('on', 'Which company has #1 AI model end of October? (Style Control On)', 10));
});

test('findEvent falls back to search when the slug has a timestamp suffix', async () => {
  const calls = [];
  const http = async url => {
    calls.push(url);
    if (url.includes('/public-search')) return { events: [
      { slug: 'x-2025', title: 'Which company has best AI model end of September?', endDate: '2025-09-30T00:00:00Z' },
      { slug: 'x-2026', title: 'Which company has the best AI model end of September?', endDate: '2026-09-30T16:00:00Z' },
    ] };
    if (url.includes('slug=x-2026')) return [{ slug: 'x-2026', endDate: '2026-09-30T16:00:00Z', markets: [] }];
    return [];
  };
  const ev = await findEvent('off', { year: 2026, month: 9 }, {}, { http });
  assert.equal(ev.slug, 'x-2026');
});

test('findEvent returns null when nothing matches', async () => {
  const http = async url => (url.includes('/public-search') ? { events: [] } : []);
  assert.equal(await findEvent('on', { year: 2026, month: 11 }, {}, { http }), null);
});

test('placeholder "Company X" outcomes are dropped', () => {
  const ev = { ...fixture, markets: [...fixture.markets, { ...fixture.markets[0], groupItemTitle: 'Company A' }] };
  assert.equal(parseEvent(ev).outcomes.some(o => o.company === 'Company A'), false);
});
