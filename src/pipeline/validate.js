// Reject data we should not trust (spec §12).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateLeaderboard(rows) {
  const errors = [];
  if (!Array.isArray(rows) || rows.length < 5) errors.push(`มีแถว overall น้อยเกินไป (${rows?.length ?? 0})`);
  for (const r of rows ?? []) {
    if (typeof r.model_name !== 'string' || !r.model_name) { errors.push('model_name ว่าง'); break; }
    if (!Number.isFinite(r.rating) || !Number.isFinite(r.variance) || r.variance < 0) { errors.push(`ตัวเลขผิดปกติที่ ${r.model_name}`); break; }
    if (!DATE_RE.test(r.leaderboard_publish_date ?? '')) { errors.push(`วันที่ผิดรูปแบบที่ ${r.model_name}`); break; }
  }
  const dates = new Set((rows ?? []).map(r => r.leaderboard_publish_date));
  if (dates.size > 1) errors.push(`latest มีหลายวันที่ปนกัน: ${[...dates].join(', ')}`);
  return { ok: errors.length === 0, errors };
}

export function validateEvent(parsed) {
  const errors = [];
  if (!parsed) return { ok: false, errors: ['ไม่พบ event'] };
  if (parsed.outcomes.length < 2) errors.push('event มีตัวเลือกน้อยกว่า 2');
  if (parsed.outcomes.some(o => !o.yesToken || !o.noToken)) errors.push('บางตัวเลือกไม่มี token');
  return { ok: errors.length === 0, errors };
}
