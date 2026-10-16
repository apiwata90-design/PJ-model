// Plain-Thai reasons behind the forecast (spec §10.3).
import { companyOf } from './rules.js';
import { NEW_MODEL_SUFFIX } from './simulate.js';

const pct = p => `${Math.round(p * 100)}%`;
const halfCi = m => (m.rating_upper - m.rating_lower) / 2;

export function explain({ models, companyMap, sim, newModel, hDays, trend }) {
  const [leader] = models;
  if (!leader) return ['ไม่มีข้อมูล leaderboard'];
  const lines = [];
  const leaderCo = companyOf(leader.organization, companyMap);
  const rival = models.find(m => companyOf(m.organization, companyMap) !== leaderCo);

  const [topCo, topP] = Object.entries(sim.companies)[0] ?? [leaderCo, 0];
  lines.push(`จำลอง ${sim.n ?? 0} รอบ: ${topCo} ได้อันดับ 1 ${pct(topP)} · เหลือ ${hDays.toFixed(1)} วันถึงเวลาตัดสิน`);

  if (rival) {
    const gap = leader.rating - rival.rating;
    const ciSum = halfCi(leader) + halfCi(rival);
    lines.push(`${leader.model_name} (${leaderCo}) นำ ${rival.model_name} (${companyOf(rival.organization, companyMap)}) อยู่ ${gap.toFixed(1)} แต้ม` +
      (gap < ciSum ? ` — ช่วง CI ยังซ้อนกัน (±${ciSum.toFixed(1)}) จึงสลับกันได้` : ` — ห่างเกินช่วง CI (±${ciSum.toFixed(1)})`));

    const dl = trend[leader.model_name], dr = trend[rival.model_name];
    if (dl !== undefined && dr !== undefined) {
      const perWeek = (dl - dr) * 7;
      lines.push(Math.abs(perWeek) < 0.5
        ? 'ช่วง 14 วันล่าสุด ระยะห่างแทบไม่เปลี่ยน'
        : `ช่วง 14 วันล่าสุด ระยะห่าง${perWeek < 0 ? 'แคบลง' : 'กว้างขึ้น'} ~${Math.abs(perWeek).toFixed(1)} แต้ม/สัปดาห์`);
    }
  }

  const newRisk = Object.entries(sim.models).filter(([k]) => k.endsWith(NEW_MODEL_SUFFIX))
    .sort((a, b) => b[1] - a[1]);
  if (newRisk.length) {
    const total = newRisk.reduce((a, [, p]) => a + p, 0);
    const [name, p] = newRisk[0];
    lines.push(`โอกาสที่ model ใหม่ (ยังไม่อยู่บน leaderboard) ขึ้นมาเป็นอันดับ 1 รวม ${pct(total)} — มากสุดคือ ${name.replace(NEW_MODEL_SUFFIX, '')} ${pct(p)}`);
  } else {
    lines.push('โอกาสที่ model ใหม่จะขึ้นมาแซงก่อนตัดสินต่ำมากในรอบนี้');
  }

  const rates = Object.entries(newModel).filter(([, v]) => v.lambdaPerDay > 0)
    .sort((a, b) => b[1].lambdaPerDay - a[1].lambdaPerDay).slice(0, 3)
    .map(([c, v]) => `${c} ~${(v.lambdaPerDay * 30).toFixed(1)}`);
  if (rates.length) lines.push(`สถิติปีที่ผ่านมา: model ใหม่ที่ติด top 10 ต่อเดือน — ${rates.join(' · ')}`);
  return lines;
}
