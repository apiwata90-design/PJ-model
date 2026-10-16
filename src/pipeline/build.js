// Pure glue: data in, MarketForecast out (no network, no fs). Used by run.js and backtest.js.
import { simulate } from '../core/simulate.js';
import { eligible, companyOf } from '../core/rules.js';
import { checkTimeUtc, hoursUntil } from '../core/calendar.js';
import { evaluateCompany } from '../core/edge.js';
import { assessRisk } from '../core/risk.js';
import { explain } from '../core/explain.js';
import { cacheMerge, newModelRates, debutDeltas, driftPerDay, upTo, publishDates, snapshotAt } from './history.js';

export const MARKET_LABEL = { off: 'Style Control ปิด', on: 'Style Control เปิด' };

export function simInputsFor({ latestRows, historyRows, target, now, config, seed }) {
  const { settings, calibration, overrides, companies } = config;
  const autoEval = new Set(overrides.autoEval ?? []);
  const models = eligible(latestRows, autoEval).sort((a, b) => b.rating - a.rating);
  const publishDate = models[0]?.leaderboard_publish_date;
  const history = cacheMerge(upTo(historyRows, publishDate), latestRows.filter(r => r.rank <= settings.historyMaxRank));
  const trend = driftPerDay(history, publishDate, { days: settings.driftDays });
  const checkAt = checkTimeUtc(target.year, target.month);
  const hDays = Math.max(hoursUntil(now, checkAt) / 24, 0);
  const newModel = newModelRates(history, publishDate, companies, settings.rates);
  const observed = debutDeltas(history, publishDate, companies, settings.deltas);
  // Too few debuts observed (e.g. history fetch failed) -> fall back to a documented prior instead of
  // silently assuming no new model can win.
  const usePrior = observed.length < (settings.minDeltas ?? 5);
  const inputs = {
    models: models.filter(m => m.rating >= (models[0]?.rating ?? 0) - settings.window).map(m => ({ name: m.model_name, org: m.organization, rating: m.rating, variance: m.variance, drift: trend[m.model_name] ?? 0 })),
    companyMap: companies,
    hDays,
    n: settings.nSims,
    seed,
    params: { k: calibration.k, sigmaFloor: calibration.sigmaFloor, driftShrink: calibration.driftShrink, window: settings.window },
    newModel,
    debutDeltas: usePrior ? settings.deltaPrior : observed,
    deltaSource: usePrior ? 'prior' : 'history',
    overrides: overrides.news ?? {},
    lagDays: settings.lagDays,
  };
  return { inputs, models, publishDate, history, trend, checkAt, autoEval };
}

function chartSeries(history, models, days) {
  const dates = publishDates(history);
  const last = dates.at(-1);
  const from = new Date(new Date(last + 'T00:00:00Z').getTime() - days * 86400000).toISOString().slice(0, 10);
  const shown = dates.filter(d => d >= from);
  const top = models.slice(0, 5).map(m => m.model_name);
  const series = Object.fromEntries(top.map(name => [name, shown.map(d =>
    snapshotAt(history, d).find(r => r.model_name === name)?.rating ?? null)]));
  return { dates: shown, series };
}

export function buildForecast({ key, latestRows, historyRows, target, now, config, seed }) {
  const { settings, companies } = config;
  const { inputs, models, publishDate, history, trend, checkAt, autoEval } =
    simInputsFor({ latestRows, historyRows, target, now, config, seed });
  const sim = simulate(inputs);
  return {
    key,
    label: MARKET_LABEL[key],
    target,
    checkAt: checkAt.toISOString(),
    hoursLeft: hoursUntil(now, checkAt),
    publishDate,
    leaderboard: models.slice(0, 15).map(m => ({
      model: m.model_name, org: m.organization, company: companyOf(m.organization, companies),
      rating: m.rating, lower: m.rating_lower, upper: m.rating_upper, votes: m.vote_count, rank: m.rank,
      driftPerDay: trend[m.model_name] ?? null,
    })),
    sim,
    simInputs: inputs,
    reasons: [
      ...explain({ models, companyMap: companies, sim, newModel: inputs.newModel, hDays: inputs.hDays, trend }),
      ...(inputs.deltaSource === 'prior' ? ['⚠ ประวัติ leaderboard ไม่พอ — คะแนนของ model ใหม่ใช้ค่าตั้งต้น (settings.deltaPrior) แทนสถิติจริง'] : []),
    ],
    chart: chartSeries(history, models, settings.chartDays),
    market: { found: false },
    edges: {},
    risks: assessRisk({ now, checkAt, publishDate, models, companyMap: companies, autoEval, marketFound: false, settings }),
    _ctx: { models, autoEval, checkAt, now },
  };
}

// Probability we assign to each market outcome; "Other" collects companies the market does not list.
export function outcomeProbs(sim, outcomeNames) {
  const listed = new Set(outcomeNames);
  const probs = Object.fromEntries(outcomeNames.map(n => [n, sim.companies[n] ?? 0]));
  if (listed.has('Other')) {
    probs.Other = Object.entries(sim.companies).filter(([c]) => !listed.has(c)).reduce((a, [, p]) => a + p, 0);
  }
  return probs;
}

export function outcomesNeedingBooks(forecast, event, minProb) {
  const probs = outcomeProbs(forecast.sim, event.outcomes.map(o => o.company));
  return event.outcomes.filter(o => !o.closed && ((probs[o.company] ?? 0) >= minProb || (o.yesPrice ?? 0) >= minProb));
}

// Quoted mid if both sides exist, else last trade; outcomePrices alone (0.5 on untraded markets) is not a price.
export function marketMid(o) {
  if (o.bestBid !== null && o.bestAsk !== null && o.bestAsk > 0) return (o.bestBid + o.bestAsk) / 2;
  return o.lastPrice ?? null;
}

export function attachMarket(forecast, event, books, config) {
  const { settings, companies } = config;
  const { models, autoEval, checkAt, now } = forecast._ctx;
  const out = { ...forecast };
  if (event) {
    const probs = outcomeProbs(forecast.sim, event.outcomes.map(o => o.company));
    out.market = { found: true, slug: event.slug, title: event.title, endDate: event.endDate,
      mids: Object.fromEntries(event.outcomes.map(o => [o.company, marketMid(o)])) };
    out.edges = {};
    for (const o of event.outcomes) {
      const yes = books[o.yesToken], no = books[o.noToken];
      if (!yes || !no) continue;
      out.edges[o.company] = evaluateCompany({ pYes: probs[o.company] ?? 0, yes, no, lastPrice: o.lastPrice,
        schedule: o.schedule, stakes: settings.stakes, threshold: settings.edgeThreshold });
    }
  }
  out.risks = assessRisk({ now, checkAt, publishDate: forecast.publishDate, models, companyMap: companies,
    autoEval, marketFound: Boolean(event), settings });
  delete out._ctx;
  return out;
}
