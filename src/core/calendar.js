// Polymarket checks the leaderboard at 12:00 PM New York time on the last day of the month.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

function nthSunday(year, month1, n) {
  const first = new Date(Date.UTC(year, month1 - 1, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + 7 * (n - 1);
}

// US DST: 2nd Sunday of March through the day before the 1st Sunday of November.
function isEdt(year, month1, day) {
  if (month1 < 3 || month1 > 11) return false;
  if (month1 > 3 && month1 < 11) return true;
  if (month1 === 3) return day >= nthSunday(year, 3, 2);
  return day < nthSunday(year, 11, 1);
}

export function checkTimeUtc(year, month1) {
  const lastDay = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  const offset = isEdt(year, month1, lastDay) ? 4 : 5;
  return new Date(Date.UTC(year, month1 - 1, lastDay, 12 + offset));
}

export function targetMonth(now) {
  let year = now.getUTCFullYear(), month = now.getUTCMonth() + 1;
  if (now >= checkTimeUtc(year, month)) {
    month += 1;
    if (month === 13) { month = 1; year += 1; }
  }
  return { year, month };
}

export function hoursUntil(now, t) {
  return (t.getTime() - now.getTime()) / 3600000;
}

export function monthSlugName(month1) {
  return MONTHS[month1 - 1];
}

export function monthKey({ year, month }) {
  return `${year}-${String(month).padStart(2, '0')}`;
}
