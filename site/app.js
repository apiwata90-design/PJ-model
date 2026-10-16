// Dashboard: reads data/latest/forecast.json and re-runs simulate() locally for what-if inputs.
// Works both locally (repo root served, page at /site/) and on Pages (core/ and data/ next to index.html).

const BASES = ['./', '../'];
let base = './';
let simulate = null;
let NEW_SUFFIX = ' · model ใหม่';

// Okabe–Ito based, fixed per company (color follows the entity, never its rank).
const COLORS = {
  light: { Google: '#0072B2', Anthropic: '#D55E00', OpenAI: '#009E73', Meta: '#CC79A7', SpaceXAI: '#6B6B6B', DeepSeek: '#56B4E9', Alibaba: '#E69F00', _other: '#9A9A9A' },
  dark: { Google: '#5AA9E6', Anthropic: '#FF8A4C', OpenAI: '#3CCB9A', Meta: '#E19BC6', SpaceXAI: '#B5B5B5', DeepSeek: '#8FD0F5', Alibaba: '#F2B640', _other: '#8A8A8A' },
};
const isDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
const colorOf = c => { const p = COLORS[isDark() ? 'dark' : 'light']; return p[c] ?? p._other; };

const $ = id => document.getElementById(id);
const pct = (p, d = 0) => (p === null || p === undefined ? '–' : `${(p * 100).toFixed(d)}%`);
const cents = p => (p === null || p === undefined ? '–' : `${(p * 100).toFixed(1)}¢`);
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

async function fetchFirst(path) {
  for (const b of BASES) {
    try {
      const r = await fetch(b + path, { cache: 'no-store' });
      if (r.ok) { base = b; return r; }
    } catch { /* try next */ }
  }
  return null;
}

let data, backtest = null, current = store.get('market', 'off');
const charts = {};

async function init() {
  const res = await fetchFirst('data/latest/forecast.json');
  if (!res) { $('subtitle').textContent = 'ยังไม่มีข้อมูล — รัน npm run run ก่อน'; return; }
  data = await res.json();
  for (const p of ['core/simulate.js', 'src/core/simulate.js']) {
    try { const m = await import(base + p); simulate = m.simulate; NEW_SUFFIX = m.NEW_MODEL_SUFFIX; break; } catch { /* next */ }
  }
  try { const r = await fetch(base + 'data/backtest/report.json', { cache: 'no-store' }); if (r.ok) backtest = await r.json(); } catch { /* optional */ }
  if (!data.markets[current]?.sim) current = 'off';
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { current = b.dataset.key; store.set('market', current); render(); }));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
  render();
  setInterval(renderCountdown, 30000);
}

function m() { return data.markets[current]; }

function render() {
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.key === current)));
  const f = m();
  const gen = new Date(data.generated_at);
  const ageH = (Date.now() - gen) / 3600000;
  $('subtitle').textContent = `ตลาดเดือน ${data.targetKey} · อัปเดต ${gen.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`;
  const banner = $('stale-banner');
  if (ageH > 6 || data.status.stale) {
    banner.hidden = false;
    banner.textContent = ageH > 6
      ? `⚠ ข้อมูลเก่า ${ageH.toFixed(0)} ชม. — อย่าใช้ตัดสินใจจนกว่าระบบจะอัปเดต`
      : '⚠ บางแหล่งข้อมูลดึงไม่สำเร็จ ใช้ข้อมูลรอบก่อนอยู่ — ดูส่วนสถานะข้อมูล';
  } else banner.hidden = true;
  if (!f?.sim) { $('headline').textContent = f?.error ?? 'ไม่มีข้อมูลตลาดนี้'; return; }
  $('resolve-link').href = current === 'off' ? 'https://arena.ai/leaderboard/text/overall-no-style-control' : 'https://arena.ai/leaderboard/text/overall';
  renderCountdown();
  renderSummary(f);
  renderEdge(f);
  $('reasons').innerHTML = f.reasons.map(r => `<li>${esc(r)}</li>`).join('');
  renderWhatIf(f);
  renderCharts(f);
  renderBacktest();
  renderStatus(f);
  renderModels(f);
}

function renderCountdown() {
  const t = new Date(data.checkAt), h = (t - Date.now()) / 3600000;
  $('countdown').textContent = h <= 0 ? 'ถึงเวลาตัดสินแล้ว' : `${Math.floor(h / 24)} วัน ${Math.floor(h % 24)} ชม.`;
  $('check-at').textContent = `(${t.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })} เวลาไทย)`;
}

function topCompanies(f, n = 4) {
  return Object.entries(f.sim.companies).slice(0, n);
}

function renderSummary(f) {
  $('headline').innerHTML = topCompanies(f).map(([c, p]) => {
    const mid = f.market.mids?.[c];
    return `<div class="co"><div class="name"><span class="dot" style="background:${colorOf(c)}"></span>${esc(c)}</div>
      <div class="p num">${pct(p)}</div><div class="mkt">ตลาด ${mid !== undefined ? cents(mid) : '–'}</div></div>`;
  }).join('');
  const signals = Object.entries(f.edges).filter(([, e]) => e.signal);
  const adv = $('advice');
  if (!f.market.found) { adv.className = 'advice'; adv.textContent = 'ยังไม่พบตลาด Polymarket ของเดือนนี้ — มีแค่ผลทาย'; return; }
  if (signals.length) {
    adv.className = 'advice good';
    adv.textContent = '💡 ' + signals.map(([c, e]) => `${e.signal === 'yes' ? 'ซื้อ YES' : 'ซื้อ NO'} ${c}: เราให้ ${pct(e.pYes)} ตลาด ${cents(e.mid)} (EV ${pct(e[e.signal][0].ev)} ที่ $${e[e.signal][0].stake})`).join(' · ');
  } else {
    adv.className = 'advice';
    adv.textContent = `💡 ยังไม่มีจุดได้เปรียบชัดเจน — ผลทายต่างจากราคาตลาดไม่ถึง 10 จุด หรือส่วนต่างโดนค่าธรรมเนียม/spread กินหมด`;
  }
}

function fillCell(fills) {
  return fills.map(x => x.ev === null ? `<span class="muted">ไม่มีคนขาย</span>`
    : `<span class="num">${cents(x.avgPrice)}</span> <span class="muted small">EV ${x.ev >= 0 ? '+' : ''}${pct(x.ev)}${x.complete ? '' : ` · ได้แค่ $${x.spentUsd.toFixed(0)}`}</span>`).join('<br>');
}

function renderEdge(f) {
  const rows = Object.entries(f.edges).sort((a, b) => b[1].pYes - a[1].pYes);
  const stakes = rows[0]?.[1].yes.map(x => `$${x.stake}`).join(' / ') ?? '';
  $('edge-table').innerHTML = rows.length ? `<thead><tr><th>บริษัท</th><th>ของเรา</th><th>ตลาด (mid)</th><th>ต่าง</th><th>ซื้อ YES ได้จริง ${stakes}</th><th>ซื้อ NO ได้จริง ${stakes}</th><th>สัญญาณ</th></tr></thead><tbody>` +
    rows.map(([c, e]) => `<tr><td><span class="dot" style="background:${colorOf(c)}"></span> ${esc(c)}</td>
      <td class="num">${pct(e.pYes, 1)}</td><td class="num">${cents(e.mid)}</td>
      <td class="num">${e.diff === null ? '–' : (e.diff >= 0 ? '+' : '') + (e.diff * 100).toFixed(1)}</td>
      <td>${fillCell(e.yes)}</td><td>${fillCell(e.no)}</td>
      <td>${e.signal ? `<span class="tag good">น่าซื้อ ${e.signal.toUpperCase()}</span>` : '<span class="tag none">ไม่มี edge</span>'}</td></tr>`).join('') + '</tbody>'
    : '<tbody><tr><td class="muted">ไม่มีข้อมูล orderbook</td></tr></tbody>';
  const bt = backtest?.markets?.[current];
  const w = $('calib-warning');
  if (bt?.market && bt.market.oursBrierSame > bt.market.brier) {
    w.hidden = false;
    w.textContent = `⚠ backtest: ระบบนี้ยังทายแม่นน้อยกว่าราคาตลาด (Brier ${bt.market.oursBrierSame.toFixed(3)} vs ตลาด ${bt.market.brier.toFixed(3)}) — "edge" ที่เห็นอาจไม่จริง`;
  } else if (!bt?.market) {
    w.hidden = false;
    w.textContent = 'ยังไม่มีผล backtest เทียบกับราคาตลาด — ใช้สัญญาณด้วยความระมัดระวัง';
  } else w.hidden = true;
}

function whatIfCompanies(f) {
  const fromSim = Object.keys(f.sim.companies).slice(0, 5);
  const fromRates = Object.entries(f.simInputs.newModel).sort((a, b) => b[1].lambdaPerDay - a[1].lambdaPerDay).slice(0, 5).map(([c]) => c);
  return [...new Set([...fromSim, ...fromRates])].slice(0, 6);
}

function renderWhatIf(f) {
  const key = `whatif-${data.targetKey}-${current}`;
  const saved = store.get(key, {});
  const cos = whatIfCompanies(f);
  $('whatif').innerHTML = cos.map(c => {
    const s = saved[c] ?? { on: false, prob: 50, delta: 10 };
    return `<div class="wi-row" data-co="${esc(c)}">
      <div class="wi-name"><label style="display:flex;gap:6px;align-items:center;font-size:1rem;color:var(--ink)"><input type="checkbox" ${s.on ? 'checked' : ''}> <span class="dot" style="background:${colorOf(c)}"></span>${esc(c)}</label></div>
      <label>โอกาสปล่อย model ใหม่ก่อนตัดสิน: <b class="num" data-out="prob">${s.prob}%</b><input type="range" min="0" max="100" step="5" value="${s.prob}" data-in="prob"></label>
      <label>คะแนนเทียบตัวดีสุดตอนนี้: <b class="num" data-out="delta">${s.delta >= 0 ? '+' : ''}${s.delta}</b><input type="range" min="-30" max="60" step="1" value="${s.delta}" data-in="delta"></label>
    </div>`;
  }).join('');
  const update = () => {
    const state = {};
    $('whatif').querySelectorAll('.wi-row').forEach(row => {
      const prob = Number(row.querySelector('[data-in=prob]').value), delta = Number(row.querySelector('[data-in=delta]').value);
      row.querySelector('[data-out=prob]').textContent = `${prob}%`;
      row.querySelector('[data-out=delta]').textContent = `${delta >= 0 ? '+' : ''}${delta}`;
      state[row.dataset.co] = { on: row.querySelector('input[type=checkbox]').checked, prob, delta };
    });
    store.set(key, state);
    runWhatIf(f, state);
  };
  $('whatif').querySelectorAll('input').forEach(i => i.addEventListener('input', update));
  update();
}

let whatIfTimer;
function runWhatIf(f, state) {
  const active = Object.entries(state).filter(([, s]) => s.on);
  const out = $('whatif-result');
  if (!active.length) { out.innerHTML = '<p class="muted small">ติ๊กบริษัทที่มีข่าวเพื่อดูผลทายแบบใส่ข่าว</p>'; return; }
  if (!simulate) { out.innerHTML = '<p class="muted small">โหลดตัวคำนวณไม่สำเร็จ</p>'; return; }
  clearTimeout(whatIfTimer);
  whatIfTimer = setTimeout(() => {
    const overrides = { ...f.simInputs.overrides };
    for (const [c, s] of active) overrides[c] = { prob: s.prob / 100, delta: s.delta };
    const newModel = { ...f.simInputs.newModel };
    for (const [c] of active) if (!newModel[c]) newModel[c] = { lambdaPerDay: 0, best: null };
    const r = simulate({ ...f.simInputs, overrides, newModel, n: 5000 });
    const cos = [...new Set([...Object.keys(r.companies).slice(0, 5), ...Object.keys(f.sim.companies).slice(0, 3)])];
    out.innerHTML = `<table><thead><tr><th>บริษัท</th><th>ทางการ</th><th>ใส่ข่าวแล้ว</th><th>ตลาด</th><th>ต่างจากตลาด</th></tr></thead><tbody>` +
      cos.map(c => {
        const mid = f.market.mids?.[c], p = r.companies[c] ?? 0, d = mid === undefined || mid === null ? null : p - mid;
        return `<tr><td><span class="dot" style="background:${colorOf(c)}"></span> ${esc(c)}</td><td class="num">${pct(f.sim.companies[c] ?? 0, 1)}</td>
          <td class="num"><b>${pct(p, 1)}</b></td><td class="num">${cents(mid)}</td>
          <td class="num">${d === null ? '–' : `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}${Math.abs(d) >= 0.1 ? ' ⚑' : ''}`}</td></tr>`;
      }).join('') + '</tbody></table><p class="muted small">⚑ = ต่างจากตลาด ≥ 10 จุด (ยังไม่หักค่าธรรมเนียม/spread — ดูตารางด้านบนสำหรับราคาที่ซื้อได้จริง)</p>';
  }, 120);
}

function chartTheme() {
  const css = getComputedStyle(document.documentElement);
  return { ink: css.getPropertyValue('--ink-2').trim(), grid: css.getPropertyValue('--line').trim(), font: css.getPropertyValue('--font').trim() };
}

function renderCharts(f) {
  if (!window.Chart) return;
  const t = chartTheme();
  Chart.defaults.color = t.ink;
  Chart.defaults.font.family = t.font;
  const common = {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 2, usePointStyle: false } } },
    scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } }, y: { grid: { color: t.grid } } },
  };

  // Ratings: one hue per company, dashed for a company's 2nd+ model.
  const seen = {};
  const companyOfModel = Object.fromEntries(f.leaderboard.map(r => [r.model, r.company]));
  const rating = Object.entries(f.chart.series).map(([name, vals]) => {
    const c = companyOfModel[name]; seen[c] = (seen[c] ?? 0) + 1;
    return { label: name, data: vals, borderColor: colorOf(c), backgroundColor: colorOf(c), borderWidth: 2, pointRadius: 0, pointHitRadius: 10, spanGaps: true, borderDash: seen[c] > 1 ? [6, 4] : [] };
  });
  charts.rating?.destroy();
  charts.rating = new Chart($('chart-rating'), { type: 'line', data: { labels: f.chart.dates, datasets: rating },
    options: { ...common, scales: { ...common.scales, y: { ...common.scales.y, title: { display: true, text: 'Arena score' } } } } });

  // Ours vs market over the month, top 2 companies.
  fetch(base + `data/history/${data.targetKey}.jsonl`, { cache: 'no-store' }).then(r => (r.ok ? r.text() : '')).then(txt => {
    const lines = txt.trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(l => l.markets[current]);
    $('history-empty').hidden = lines.length >= 2;
    const labels = lines.map(l => new Date(l.t).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' }) + ' ' + new Date(l.t).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }));
    const cos = topCompanies(f, 2).map(([c]) => c);
    const ds = cos.flatMap(c => [
      { label: `${c} · ของเรา`, data: lines.map(l => (l.markets[current].ours[c] ?? 0) * 100), borderColor: colorOf(c), borderWidth: 2, pointRadius: 0, pointHitRadius: 10 },
      { label: `${c} · ตลาด`, data: lines.map(l => (l.markets[current].mid[c] ?? null) * 100), borderColor: colorOf(c), borderWidth: 2, borderDash: [6, 4], pointRadius: 0, pointHitRadius: 10 },
    ]);
    charts.history?.destroy();
    charts.history = new Chart($('chart-history'), { type: 'line', data: { labels, datasets: ds },
      options: { ...common, scales: { ...common.scales, y: { ...common.scales.y, min: 0, max: 100, title: { display: true, text: '%' } } } } });
  });
}

function renderBacktest() {
  const bt = backtest?.markets?.[current];
  if (!bt) { $('backtest').innerHTML = '<p class="muted">ยังไม่ได้รัน backtest (npm run backtest)</p>'; return; }
  const stat = (label, v, sub = '') => `<div class="stat"><div class="muted small">${label}</div><div class="v num">${v}</div><div class="muted small">${sub}</div></div>`;
  $('backtest').innerHTML = `<div class="stats">
      ${stat('ทายบริษัทถูก (อันดับ 1 ของเรา)', pct(bt.hitRate), `${bt.n} จุดทดสอบ`)}
      ${stat('Brier ของเรา', bt.brier.toFixed(3), 'ยิ่งต่ำยิ่งดี')}
      ${stat('Brier "ผู้นำตอนนี้ชนะแน่"', bt.leaderBrier.toFixed(3), 'baseline แบบง่าย')}
      ${stat('Brier ราคาตลาด', bt.market ? bt.market.brier.toFixed(3) : '–', bt.market ? `เทียบกับเรา ${bt.market.oursBrierSame.toFixed(3)} บน ${bt.market.n} จุด` : 'ไม่มีข้อมูลราคาย้อนหลัง')}
    </div>
    <h3>Calibration — ที่บอกว่า X% เกิดจริงกี่ %</h3>
    <div class="table-wrap"><table><thead><tr><th>ช่วงที่ทาย</th><th>จำนวน</th><th>เฉลี่ยที่ทาย</th><th>เกิดจริง</th></tr></thead><tbody>` +
    bt.calibration.map(b => `<tr><td>${pct(b.bin)}–${pct(b.bin + 0.1)}</td><td class="num">${b.n}</td><td class="num">${pct(b.meanP, 1)}</td><td class="num">${pct(b.freq, 1)}</td></tr>`).join('') +
    `</tbody></table></div><p class="muted small">ทดสอบย้อนหลัง ${bt.fit?.trainMonths + bt.fit?.testMonths} เดือน ที่ 15/7/3/1 วันก่อนตัดสิน · k=${bt.fit?.k}, σ floor=${bt.fit?.sigmaFloor} · อัปเดต ${new Date(backtest.generated_at).toLocaleDateString('th-TH')}</p>`;
}

function renderStatus(f) {
  const src = Object.entries(data.status.sources).map(([k, s]) =>
    `<li><span class="lvl ${s.ok ? 'ok' : s.stale ? 'warn' : 'danger'}">${s.ok ? 'OK' : s.stale ? 'เก่า' : 'ล้ม'}</span><span>${esc(k)}${s.error ? ` — ${esc(s.error)}` : ''}</span></li>`).join('');
  $('status').innerHTML = `<p class="small">leaderboard publish: <b>${esc(f.publishDate)}</b> · ระบบรันล่าสุด: <b>${new Date(data.generated_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</b></p><ul class="risks">${src}</ul><h3>ความเสี่ยงการตัดสิน</h3>`;
  const label = { ok: 'OK', warn: 'ระวัง', danger: 'อันตราย' };
  $('risks').innerHTML = f.risks.map(r => `<li><span class="lvl ${r.level}">${label[r.level]}</span><span>${esc(r.text)}</span></li>`).join('');
}

function renderModels(f) {
  $('model-table').innerHTML = '<thead><tr><th>model</th><th>โอกาสได้อันดับ 1</th></tr></thead><tbody>' +
    Object.entries(f.sim.models).slice(0, 12).map(([name, p]) =>
      `<tr><td>${esc(name)}</td><td class="num">${pct(p, 1)}<span class="bar" style="width:${Math.round(p * 120)}px"></span></td></tr>`).join('') + '</tbody>';
  $('lb-table').innerHTML = '<thead><tr><th>model</th><th>บริษัท</th><th>score</th><th>CI</th><th>votes</th><th>แนวโน้ม/วัน</th></tr></thead><tbody>' +
    f.leaderboard.map(r => `<tr><td>${esc(r.model)}</td><td>${esc(r.company)}</td><td class="num">${r.rating.toFixed(1)}</td>
      <td class="num">±${((r.upper - r.lower) / 2).toFixed(1)}</td><td class="num">${r.votes.toLocaleString()}</td>
      <td class="num">${r.driftPerDay === null ? '–' : (r.driftPerDay >= 0 ? '+' : '') + r.driftPerDay.toFixed(2)}</td></tr>`).join('') + '</tbody>';
}

init();
