# Arena #1 Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Static dashboard + scheduled pipeline that forecasts which company/model is #1 on arena.ai Text Arena (Overall, style control off & on) at Polymarket's month-end check, and shows edge vs. executable market prices.

**Architecture:** Zero-dependency Node ES modules. `src/core/` is pure (runs in Node and the browser); `src/pipeline/` does network/fs and writes JSON into `data/`. `site/` reads `data/` and re-runs `simulate()` in the browser for the "สิ่งที่คุณรู้" what-if inputs.

**Tech Stack:** Node ≥ 20 (`node --test`, global `fetch`), vanilla HTML/CSS/JS, Chart.js 4.4.1 from cdnjs, GitHub Actions + Pages.

**Spec:** `docs/superpowers/specs/2026-10-16-arena-forecast-design.md`

**Execution note (user decision 2026-10-16):** user said "ทำยาวๆเลย" → implement inline (Native) continuously. **No git commits without user review** (global rule) — "commit" steps become "update RESUME.md checkpoint". No push / repo creation without asking.

## Global Constraints

- No npm dependencies. Node ≥ 20. ES modules (`"type": "module"`).
- `src/core/*` must not import `fs`, `path`, or call `fetch`.
- Thai for all user-facing text; times shown in Asia/Bangkok.
- Check time = 12:00 America/New_York on the last day of the month.
- Fee = `shares × rate × (p × (1 − p))^exponent`, taker only (docs.polymarket.com/trading/fees, verified 2026-10-16).
- Edge highlight threshold 0.10; stakes $100 and $1,000; N = 10,000 sims; fixed seed per run.
- HF configs: `off` → `text`, `on` → `text_style_control`; only `category == "overall"`.
- No secrets, no wallet access, no auto-trading.

## Review Focus

1. Month rollover: after the Oct 31 16:00Z check the pipeline must target November's market (and not crash if November's event doesn't exist yet) → `calendar.test.js` "after check → next month", `run.test.js` "market missing → status danger, forecast still written".
2. HF org names not in `companies.json` (e.g. a new lab) → counted under its raw org name, never silently dropped; risk `unknown-org` → `risk.test.js`.
3. Thin/one-sided orderbook (no asks, or stake bigger than book) → `complete:false`, `filledUsd` < stake, EV computed on what filled; no NaN → `edge.test.js`.
4. Stale/failed source → previous good snapshot reused, `status.sources[x].stale = true`; page shows red banner when `generated_at` > 6h old → `run.test.js`, manual site check.
5. DST boundary: check time on months ending in EST (Nov–Feb) is 17:00Z, EDT months 16:00Z → `calendar.test.js`.

---

## File map

| File | Responsibility |
|---|---|
| `package.json` | `type: module`, scripts `test`, `run`, `backtest`, `serve` |
| `src/core/rng.js` | `makeRng(seed)`, `normal(rng)`, `poisson(rng, lambda)` |
| `src/core/calendar.js` | `checkTimeUtc(y,m)`, `targetMonth(now)`, `hoursUntil(now,t)`, `monthSlugName(m)` |
| `src/core/rules.js` | `companyOf(org, map)`, `eligible(rows, autoEval)`, `resolveWinner(rows, map)` |
| `src/core/simulate.js` | `simulate(inputs)` Monte Carlo |
| `src/core/edge.js` | `takerFee`, `walkAsks`, `evaluateCompany` |
| `src/core/risk.js` | `assessRisk(ctx)` |
| `src/core/explain.js` | `explain(ctx)` Thai bullets |
| `src/pipeline/http.js` | `getJson(url, opts)` with timeout+retry |
| `src/pipeline/arena.js` | `fetchLatest(cfg)`, `fetchHistory(cfg, sinceDate, maxRank)` |
| `src/pipeline/history.js` | `newModelRates`, `debutDeltas`, `driftPerDay`, `cacheMerge` |
| `src/pipeline/polymarket.js` | `findEvent`, `parseEvent`, `fetchBook`, `priceHistory` |
| `src/pipeline/validate.js` | `validateLeaderboard`, `validateEvent` |
| `src/pipeline/build.js` | `buildMarketForecast(...)` pure-ish glue (no network) |
| `src/pipeline/run.js` | CLI orchestrator, audit trail writes |
| `src/pipeline/backtest.js` | backtest + calibration fit CLI |
| `config/*.json` | settings, companies, markets, overrides, calibration |
| `site/index.html, app.js, styles.css` | dashboard |
| `.github/workflows/*.yml` | forecast, backtest, pages |
| `tests/*.test.js`, `tests/fixtures/*` | tests |

---

### Task 1: Scaffold + rng + calendar

**Files:** Create `package.json`, `.gitignore`, `src/core/rng.js`, `src/core/calendar.js`, `tests/rng.test.js`, `tests/calendar.test.js`

**Interfaces — Produces:**
- `makeRng(seed:number) → () => number` (mulberry32, [0,1))
- `normal(rng) → number` (Box–Muller, standard normal)
- `poisson(rng, lambda:number) → integer` (Knuth; lambda ≤ 30)
- `checkTimeUtc(year, month1to12) → Date` 12:00 New York on last day of month
- `targetMonth(now:Date) → {year, month}` — this month if `now < checkTimeUtc(this)`, else next month
- `hoursUntil(now, t) → number` (may be negative)
- `monthSlugName(month) → "october"`

- [ ] Tests: same seed → identical first 5 values; normal mean≈0 sd≈1 over 20k draws (±0.03); poisson(λ=2) mean≈2 (±0.05).
- [ ] Tests: `checkTimeUtc(2026,10)` = `2026-10-31T16:00:00Z`; `checkTimeUtc(2026,11)` = `2026-11-30T17:00:00Z`; `checkTimeUtc(2027,2)` = `2027-02-28T17:00:00Z`; `targetMonth(2026-10-31T16:00:01Z)` = `{2026,11}`; `targetMonth(2026-12-31T18:00Z)` = `{2027,1}`.
- [ ] Implement. DST rule: US DST from 2nd Sunday of March 07:00Z-ish to 1st Sunday of November; for a noon local check only the date matters → offset −4 if date ∈ [2nd Sun Mar, 1st Sun Nov) else −5.
- [ ] `node --test` passes → RESUME checkpoint.

### Task 2: Resolution rules

**Files:** `src/core/rules.js`, `tests/rules.test.js`

**Produces:**
- `companyOf(org:string, map:Record<string,string>) → string` (lower-cased lookup; unknown → org as-is)
- `eligible(rows, autoEval:Set<string>) → rows` (drops `model_name` in set)
- `resolveWinner(rows, map) → {model, company, rating}` — order by `rank` asc, then `rating` desc, then company name asc.

- [ ] Tests: AutoEval model with best rank is skipped; rank tie → higher rating; rank+rating tie → alphabetical company; unknown org returned raw.
- [ ] Implement → tests pass → checkpoint.

### Task 3: Monte Carlo simulate

**Files:** `src/core/simulate.js`, `tests/simulate.test.js`

**Consumes:** rng.js, rules.companyOf
**Produces:** `simulate(inputs) → {companies:Record<string,number>, models:Record<string,number>, n}` where
```
inputs = {
  models: [{name, org, rating, variance, drift}],   // drift = rating points/day
  companyMap, hDays, n, seed,
  params: { k, sigmaFloor, driftShrink, window },    // window: only models with rating ≥ leader − window
  newModel: { [company]: { lambdaPerDay, best } },  // best = company's current best rating
  debutDeltas: number[],                              // empirical (debut − company prev best)
  overrides: { [company]: { prob, delta } },         // replaces Poisson for that company
  lagDays: 1
}
```
Per sim: existing model final = `rating + drift*hDays*driftShrink + N(0, k*sqrt(variance)*sqrt(max(hDays,0.5)/30) + sigmaFloor)`; per company new models: count ~ Poisson(lambda * max(hDays − lagDays, 0)) (or Bernoulli(prob) when overridden) each with `best + sample(debutDeltas)` (or `best + delta` when overridden); new model key `"<company> · model ใหม่"`. Winner = max final.

- [ ] Tests: deterministic with seed; leader +100, h=1 → >0.99; two equal models (different companies) → 0.5±0.02; override `{prob:1, delta:50}` for a third company → >0.97; probabilities sum to 1±1e-9.
- [ ] Implement → pass → checkpoint.

### Task 4: Edge

**Files:** `src/core/edge.js`, `tests/edge.test.js`

**Produces:**
- `takerFee(shares, price, schedule={rate, exponent=1, takerOnly}) → usd` (`shares*rate*(p*(1-p))**exponent`)
- `walkAsks(asks:[{price,size}], stakeUsd, schedule) → {shares, avgPrice, feeUsd, spentUsd, complete}` — spends `stakeUsd` including fees, cheapest first
- `evaluateCompany({pYes, yes:{asks,bids}, no:{asks,bids}, schedule, stakes, threshold}) → {mid, diff, yes:[Fill&{stake, ev}], no:[...], signal:"yes"|"no"|null}`; `ev = shares*p_side/spentUsd − 1`; mid from yes best bid/ask (fallback last price); signal when `|pYes−mid| ≥ threshold` and the ev of the smallest stake on that side > 0.

- [ ] Tests: docs example 100 sh @0.50 rate 0.07 → $1.75; walk across 3 levels; empty asks → shares 0, complete false, ev null; signal yes when pYes 0.8 vs mid 0.6 with cheap asks; no signal when edge eaten by spread.
- [ ] Implement → pass → checkpoint.

### Task 5: Risk + explain

**Files:** `src/core/risk.js`, `src/core/explain.js`, `tests/risk.test.js`, `tests/explain.test.js`

**Produces:**
- `assessRisk({now, checkAt, publishDate, models(sorted desc rating, eligible), companyMap, autoEval, marketFound, settings}) → [{id, level:"ok"|"warn"|"danger", text}]` ids: `freshness, close-race, low-votes, autoeval, dataset-lag, unknown-org, market-missing`
- `explain({models, companyMap, sim, newModel, hDays, trend}) → string[]` (Thai), `trend` = `{ [model]: drift }`

- [ ] Tests: publish 4 days old → freshness warn, 8 → danger; gap < combined CI between different companies → close-race warn; < 48h to check → dataset-lag warn; org not in map within top 10 → unknown-org warn; market missing → danger. explain returns ≥ 3 strings, mentions leader name and gap.
- [ ] Implement → pass → checkpoint.

### Task 6: HTTP + arena + history

**Files:** `src/pipeline/http.js`, `src/pipeline/arena.js`, `src/pipeline/history.js`, `tests/history.test.js`, `tests/fixtures/history-mini.json`

**Produces:**
- `getJson(url, {timeoutMs=30000, retries=3, fetchImpl=fetch}) → any`
- `fetchLatest(config:"text"|"text_style_control") → rows(overall)` via `/filter?where="category"='overall'`, paged by 100
- `fetchHistory(config, sinceDate, maxRank=20) → rows` via `/filter` with `"category"='overall' AND "rank"<=maxRank AND "leaderboard_publish_date">'sinceDate'`
- `cacheMerge(oldRows, newRows) → rows` (dedupe by date+model)
- `publishDates(rows) → string[]` sorted
- `newModelRates(rows, asOf, companyMap, {lookbackDays=365, topN=10, prior=0.2/365}) → {[company]: lambdaPerDay}` — debut = first date a model_name appears; counted if rank ≤ topN at debut
- `debutDeltas(rows, asOf, companyMap, {lookbackDays=730, topN=10}) → number[]` — debut rating − same company's best rating on the previous publish
- `driftPerDay(rows, asOf, {days=14}) → {[model]: slope}` least squares over publishes in window

- [ ] Tests on fixture (hand-built 6 publishes, 3 companies): rates, deltas, drift sign, nothing after `asOf` is used.
- [ ] Implement; live smoke: `node -e` fetchLatest('text') top row printed.
- [ ] Checkpoint.

### Task 7: Polymarket client

**Files:** `src/pipeline/polymarket.js`, `tests/polymarket.test.js`, `tests/fixtures/pm-event.json`

**Produces:**
- `slugFor(marketKey, monthName) → string` (`off`: `which-company-has-the-best-ai-model-end-of-<m>`, `on`: `which-company-has-1-ai-model-end-of-<m>-style-control-on`), overridable in `config/markets.json` as `{"2026-11": {"off": "...", "on": "..."}}`
- `findEvent(marketKey, {year, month}, marketsConfig) → event|null` — slug first, fallback `gamma /public-search?q=` title match
- `parseEvent(event) → {slug, title, description, endDate, outcomes:[{company, yesToken, noToken, bestBid, bestAsk, lastPrice, schedule}]}`
- `fetchBook(tokenId) → {bids, asks}` (numbers)

- [ ] Tests: parseEvent on trimmed real fixture (double-encoded JSON strings parsed; schedule extracted).
- [ ] Implement; live smoke prints Google yes ask.
- [ ] Checkpoint.

### Task 8: Validate + build + run (audit trail)

**Files:** `src/pipeline/validate.js`, `src/pipeline/build.js`, `src/pipeline/run.js`, `config/settings.json`, `config/companies.json`, `config/markets.json`, `config/overrides.json`, `config/calibration.json`, `tests/run.test.js`

**Produces:**
- `validateLeaderboard(rows) → {ok, errors[]}`; `validateEvent(parsed) → {ok, errors[]}`
- `buildMarketForecast({key, rows, historyRows, event, books, config, now, seed}) → MarketForecast`:
  `{key, label, checkAt, hoursLeft, publishDate, leaderboard:[top15], sim, simInputs, edges:{[company]: evaluateCompany result}, market:{found, slug, title, mids}, risks, reasons}`
- `run({now, fetchers, outDir, config}) → forecast` — writes `data/snapshots/<date>/<HHMMZ>/{arena-off,arena-on,pm-off,pm-on,inputs,forecast}.json`, `data/latest/forecast.json`, appends `data/history/<YYYY-MM>.jsonl`, maintains `data/cache/history-<cfg>.json`; on fetch failure reuses `data/cache/last-good-*.json` and marks `status.sources[*].stale`. CLI: `node src/pipeline/run.js [--force]`; skips with exit 0 when invoked by the 30-min cron (`--if-final-hours`) outside the last 72h.

- [ ] Tests (injected fake fetchers, tmp dir): files written; replay from `inputs.json` + snapshot reproduces identical `sim`; PM fetcher throws → forecast written with market risk danger and status stale; month after check → November slug requested.
- [ ] Implement; live run once → inspect `data/latest/forecast.json`.
- [ ] Checkpoint.

### Task 9: Backtest + calibration

**Files:** `src/pipeline/backtest.js`, `tests/backtest.test.js`

**Produces:** `backtest({historyRows, companyMap, months, checkpoints=[15,7,3,1], params, seed}) → {rows:[{month, h, probs, actual, brier}], brier, logLoss, hitRate, calibration:[{bin, n, meanP, freq}], baselineLeader:{brier}}`; `fitParams(...) → {k, sigmaFloor}` grid k∈{0.5,0.75,1,1.5,2,3}, sigmaFloor∈{0,2,4,8} on first half, report on second half. CLI writes `data/backtest/report.json` + `config/calibration.json`. Market baseline: best effort via `priceHistory(token, ts)`; absent → `market: null`.

- [ ] Tests: look-ahead guard (fixture model appearing after checkpoint is not in inputs); perfect-leader fixture → brier near 0.
- [ ] Implement; live run on 24 months (off + on).
- [ ] Checkpoint.

### Task 10: Dashboard

**Files:** `site/index.html`, `site/app.js`, `site/styles.css`, `scripts/serve.js` (tiny static server for local dev, serves repo root)

Sections per spec §10: summary, edge table, reasons, "สิ่งที่คุณรู้" (sliders → `simulate()` imported from `../src/core/simulate.js`; on Pages the workflow copies `src/core` into the site), charts (Chart.js 4.4.1), status/risks, per-model (collapsed). Tabs off/on. Red stale banner if `generated_at` > 6h. localStorage wrapped in try/catch.

- [ ] Manual verification in browser via `node scripts/serve.js` (desktop + 390px width) — screenshot via headless Chrome.
- [ ] Checkpoint.

### Task 11: GitHub workflows

**Files:** `.github/workflows/forecast.yml`, `backtest.yml`, `pages.yml`, `README.md`

- forecast: cron `17 */2 * * *` (`run.js`) and `*/30 * 28-31 * *` (`run.js --if-final-hours`), `concurrency: forecast`, commit `data/` as github-actions bot.
- backtest: `0 3 2 * *`.
- pages: on push to main → assemble `_site/` = `site/*` + `src/core` → `_site/core` + `data/latest|history|backtest` → deploy-pages.
- [ ] YAML lint by eye + `node --test` green; README explains setup (needs user to create public repo + enable Pages → **ask user**).
- [ ] Checkpoint.

### Task 12: End-to-end verification

- [ ] `npm test` all green; live `npm run run`; `npm run backtest`; open dashboard; compare our top company with Polymarket mid (sanity: same direction); update CURRENT_STATE / NEXT_TASKS / RESUME / session summary.
