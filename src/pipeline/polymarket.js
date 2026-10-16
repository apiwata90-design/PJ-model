// Polymarket Gamma (events) + CLOB (orderbooks) — public, no key (spec §3.2).
import { getJson } from './http.js';
import { monthSlugName, monthKey } from '../core/calendar.js';

const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB = 'https://clob.polymarket.com';

const cap = s => s[0].toUpperCase() + s.slice(1);

export function slugFor(key, month1) {
  const m = monthSlugName(month1);
  return key === 'off'
    ? `which-company-has-the-best-ai-model-end-of-${m}`
    : `which-company-has-1-ai-model-end-of-${m}-style-control-on`;
}

export function titleMatches(key, title, month1) {
  const m = cap(monthSlugName(month1));
  const t = title.trim().toLowerCase();
  const re = key === 'off'
    ? new RegExp(`^which company has (the )?best ai model end of ${m.toLowerCase()}\\??$`)
    : new RegExp(`^which company has (#1|the best|best) ai model end of ${m.toLowerCase()}\\?? \\(style control on\\)$`);
  return re.test(t);
}

const sameMonth = (event, target) => String(event.endDate ?? '').slice(0, 7) === monthKey(target);

export async function findEvent(key, target, marketsConfig = {}, { http = getJson } = {}) {
  const configured = marketsConfig[monthKey(target)]?.[key];
  const slugs = [configured, slugFor(key, target.month)].filter(Boolean);
  for (const slug of slugs) {
    const found = await http(`${GAMMA}/events?slug=${encodeURIComponent(slug)}`);
    const ev = found.find(e => sameMonth(e, target));
    if (ev) return ev;
  }
  const q = key === 'off'
    ? `best AI model end of ${cap(monthSlugName(target.month))}`
    : `#1 AI model end of ${cap(monthSlugName(target.month))} Style Control On`;
  const res = await http(`${GAMMA}/public-search?q=${encodeURIComponent(q)}`);
  const hit = (res.events ?? []).find(e => titleMatches(key, e.title, target.month) && sameMonth(e, target));
  if (!hit) return null;
  const full = await http(`${GAMMA}/events?slug=${encodeURIComponent(hit.slug)}`);
  return full[0] ?? null;
}

const parseMaybe = v => (typeof v === 'string' ? JSON.parse(v) : v);
const num = v => (v === undefined || v === null || v === '' ? null : Number(v));

export function parseEvent(ev) {
  return {
    id: ev.id,
    slug: ev.slug,
    title: ev.title,
    description: ev.description,
    endDate: ev.endDate,
    closed: Boolean(ev.closed),
    outcomes: (ev.markets ?? []).map(m => {
      const names = parseMaybe(m.outcomes) ?? ['Yes', 'No'];
      const tokens = parseMaybe(m.clobTokenIds) ?? [];
      const prices = (parseMaybe(m.outcomePrices) ?? []).map(Number);
      const yesIdx = names.findIndex(n => /^yes$/i.test(n));
      const i = yesIdx < 0 ? 0 : yesIdx;
      return {
        company: m.groupItemTitle,
        yesToken: tokens[i] ?? null,
        noToken: tokens[1 - i] ?? null,
        yesPrice: prices[i] ?? null,
        bestBid: num(m.bestBid),
        bestAsk: num(m.bestAsk),
        lastPrice: num(m.lastTradePrice),
        schedule: m.feesEnabled === false ? null : (m.feeSchedule ?? null),
        closed: Boolean(m.closed),
      };
    }),
  };
}

export async function fetchBook(tokenId, { http = getJson } = {}) {
  const b = await http(`${CLOB}/book?token_id=${encodeURIComponent(tokenId)}`);
  const lv = arr => (arr ?? []).map(x => ({ price: Number(x.price), size: Number(x.size) }));
  return { bids: lv(b.bids), asks: lv(b.asks) };
}

export async function priceHistory(tokenId, startTs, endTs, { http = getJson } = {}) {
  const j = await http(`${CLOB}/prices-history?market=${encodeURIComponent(tokenId)}&startTs=${startTs}&endTs=${endTs}&fidelity=60`);
  return (j.history ?? []).map(p => ({ t: p.t, p: Number(p.p) }));
}
