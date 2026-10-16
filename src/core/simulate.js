// Monte Carlo forecast of the leaderboard at check time (spec §5).
import { makeRng, normal, poisson } from './rng.js';
import { companyOf } from './rules.js';

export const NEW_MODEL_SUFFIX = ' · model ใหม่';

export function simulate(inputs) {
  const { models, companyMap, hDays, n, seed, params, newModel = {}, debutDeltas = [],
    overrides = {}, lagDays = 1 } = inputs;
  const { k, sigmaFloor, driftShrink, window } = params;
  const rng = makeRng(seed);
  const h = Math.max(hDays, 0);

  const leader = Math.max(...models.map(x => x.rating));
  const field = models
    .filter(x => x.rating >= leader - window)
    .map(x => ({
      name: x.name,
      company: companyOf(x.org, companyMap),
      mean: x.rating + (x.drift || 0) * h * driftShrink,
      sd: k * Math.sqrt(Math.max(x.variance, 0)) * Math.sqrt(Math.max(h, 0.5) / 30) + sigmaFloor,
    }));

  const debutDays = Math.max(h - lagDays, 0);
  const contenders = Object.keys({ ...newModel, ...overrides }).map(company => ({
    company,
    best: newModel[company]?.best ?? leader,
    lambda: (newModel[company]?.lambdaPerDay ?? 0) * debutDays,
    override: overrides[company],
  }));

  const companyWins = {}, modelWins = {};
  for (let i = 0; i < n; i++) {
    let bestScore = -Infinity, bestName = null, bestCompany = null;
    for (const f of field) {
      const s = f.mean + f.sd * normal(rng);
      if (s > bestScore) { bestScore = s; bestName = f.name; bestCompany = f.company; }
    }
    for (const c of contenders) {
      let count, delta;
      if (c.override) {
        count = rng() < c.override.prob ? 1 : 0;
        delta = () => c.override.delta;
      } else {
        count = debutDeltas.length ? poisson(rng, c.lambda) : 0;
        delta = () => debutDeltas[Math.floor(rng() * debutDeltas.length)];
      }
      for (let j = 0; j < count; j++) {
        const s = c.best + delta() + (sigmaFloor + 4) * normal(rng);
        if (s > bestScore) { bestScore = s; bestName = c.company + NEW_MODEL_SUFFIX; bestCompany = c.company; }
      }
    }
    companyWins[bestCompany] = (companyWins[bestCompany] || 0) + 1;
    modelWins[bestName] = (modelWins[bestName] || 0) + 1;
  }
  const norm = o => Object.fromEntries(Object.entries(o)
    .map(([key, v]) => [key, v / n]).sort((a, b) => b[1] - a[1]));
  return { companies: norm(companyWins), models: norm(modelWins), n };
}
