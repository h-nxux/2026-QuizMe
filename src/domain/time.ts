export const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(t: number | Date) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(t: number, days: number) {
  const d = new Date(t);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

// Local calendar date key, e.g. "2026-11-17". Used for streaks and the heatmap.
export function dayKey(t: number | Date) {
  const d = new Date(t);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function startOfWeek(t: number) {
  const d = new Date(startOfDay(t));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export function relativeDue(due: number, now = Date.now()) {
  const days = Math.round((startOfDay(due) - startOfDay(now)) / DAY_MS);
  if (days <= 0) return '오늘';
  if (days === 1) return '내일';
  if (days < 7) return `${days}일 뒤`;
  if (days < 60) return `${Math.round(days / 7)}주 뒤`;
  return `${Math.round(days / 30)}개월 뒤`;
}
