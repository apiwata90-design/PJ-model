// Resolution-risk checklist (spec §7). Every check is always returned so the page can show a full table.
import { companyOf } from './rules.js';
import { hoursUntil } from './calendar.js';

const DAY_MS = 86400000;
const ci = m => (m.rating_upper - m.rating_lower) / 2;

export function assessRisk({ now, checkAt, publishDate, models, companyMap, autoEval, marketFound, settings }) {
  const out = [];
  const add = (id, level, text) => out.push({ id, level, text });

  const ageDays = (now - new Date(publishDate + 'T00:00:00Z')) / DAY_MS;
  add('freshness', ageDays > 7 ? 'danger' : ageDays > 3 ? 'warn' : 'ok',
    `leaderboard อัปเดตล่าสุด ${publishDate} (${ageDays.toFixed(1)} วันก่อน)`);

  const [leader] = models;
  const leaderCo = leader && companyOf(leader.organization, companyMap);
  const rival = models.find(m => companyOf(m.organization, companyMap) !== leaderCo);
  if (leader && rival) {
    const gap = leader.rating - rival.rating;
    const overlap = gap < ci(leader) + ci(rival);
    add('close-race', overlap ? 'warn' : 'ok', overlap
      ? `สูสี: ${leader.model_name} นำ ${rival.model_name} แค่ ${gap.toFixed(1)} แต้ม และช่วง CI ซ้อนกัน สลับอันดับได้`
      : `${leader.model_name} นำบริษัทอื่น ${gap.toFixed(1)} แต้ม เกินช่วง CI`);
  } else add('close-race', 'ok', 'ไม่มีคู่แข่งจากบริษัทอื่นในข้อมูล');

  const lowVotes = Boolean(leader) && leader.vote_count < settings.lowVotes;
  add('low-votes', lowVotes ? 'warn' : 'ok', lowVotes
    ? `${leader.model_name} มี vote แค่ ${leader.vote_count} — คะแนนยังขยับแรงได้ (อาจยังเป็น preliminary)`
    : 'จำนวน vote ของอันดับ 1 มากพอ');

  const flagged = models.slice(0, 5).filter(m => autoEval.has(m.model_name)).map(m => m.model_name);
  add('autoeval', 'warn', flagged.length
    ? `ตัดออกเพราะติด AutoEval: ${flagged.join(', ')}`
    : 'dataset ไม่มีข้อมูล AutoEval — ช่วง 48 ชม. สุดท้ายให้เช็คป้าย AutoEval บน arena.ai เอง');

  const hLeft = hoursUntil(now, checkAt);
  add('dataset-lag', hLeft < 48 ? 'warn' : 'ok', hLeft < 48
    ? 'เหลือไม่ถึง 48 ชม. — ข้อมูล HF อาจช้ากว่าเว็บจริง เปิด arena.ai เช็คด้วยตาก่อนเดิมพัน'
    : 'ยังไม่เข้าช่วง 48 ชม. สุดท้าย');

  const unknown = [...new Set(models.slice(0, 10).map(m => m.organization)
    .filter(o => !(String(o).toLowerCase() in companyMap)))];
  add('unknown-org', unknown.length ? 'warn' : 'ok', unknown.length
    ? `ไม่รู้ว่าเป็นบริษัทไหนใน Polymarket: ${unknown.join(', ')} (เพิ่มใน config/companies.json)`
    : 'บริษัทใน top 10 จับคู่กับตลาดได้ครบ');

  add('market-missing', marketFound ? 'ok' : 'danger', marketFound
    ? 'พบตลาด Polymarket ของเดือนนี้'
    : 'ไม่พบตลาด Polymarket ของเดือนนี้ — แสดงผลทายได้ แต่คำนวณ edge ไม่ได้');
  return out;
}
