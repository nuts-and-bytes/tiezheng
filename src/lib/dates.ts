export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayStr(): string {
  return toDateStr(new Date());
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(dateStr: string, n: number): string {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function weekStartOf(dateStr: string): string {
  const dow = (parseDate(dateStr).getDay() + 6) % 7; // 周一=0
  return addDays(dateStr, -dow);
}

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

/** 训练日相对文案按自然周判断；超过上一周后回到明确日期。 */
export function formatRelativeWorkoutDate(target: string, today: string): string {
  const targetDate = parseDate(target);
  const targetWeek = weekStartOf(target);
  const currentWeek = weekStartOf(today);
  const weekday = WEEKDAY_CN[targetDate.getDay()];

  if (targetWeek === currentWeek) return `本周${weekday}`;
  if (targetWeek === addDays(currentWeek, -7)) return `上周${weekday}`;

  const dateLabel = `${targetDate.getMonth() + 1}月${targetDate.getDate()}日`;
  return target.slice(0, 4) === today.slice(0, 4)
    ? dateLabel
    : `${targetDate.getFullYear()}年${dateLabel}`;
}

export function lastNDates(n: number, end: string): string[] {
  return Array.from({ length: n }, (_, i) => addDays(end, i - (n - 1)));
}

export function monthGrid(ym: string): string[] {
  const start = weekStartOf(`${ym}-01`);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function formatToday(d: Date): string {
  const week = WEEKDAY_CN[d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 周${week}`;
}
