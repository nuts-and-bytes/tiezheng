import {
  addDays, formatRelativeWorkoutDate, formatToday, lastNDates, monthGrid, parseDate,
  shiftMonth, toDateStr, weekStartOf,
} from './dates';

test('toDateStr / parseDate 互逆（本地时区）', () => {
  expect(toDateStr(new Date(2026, 6, 8))).toBe('2026-07-08');
  expect(toDateStr(parseDate('2026-07-08'))).toBe('2026-07-08');
});

test('addDays 跨月跨年', () => {
  expect(addDays('2026-07-08', -1)).toBe('2026-07-07');
  expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
  expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
});

test('weekStartOf 周一起始', () => {
  expect(weekStartOf('2026-07-08')).toBe('2026-07-06'); // 周三 → 周一
  expect(weekStartOf('2026-07-06')).toBe('2026-07-06'); // 周一 → 自身
  expect(weekStartOf('2026-07-12')).toBe('2026-07-06'); // 周日 → 上周一
});

test('lastNDates 旧到新含末日', () => {
  expect(lastNDates(3, '2026-07-08')).toEqual(['2026-07-06', '2026-07-07', '2026-07-08']);
});

test('monthGrid 42 格、周一起始', () => {
  const grid = monthGrid('2026-07');
  expect(grid).toHaveLength(42);
  expect(grid[0]).toBe('2026-06-29');
  expect(grid[41]).toBe('2026-08-09');
});

test('shiftMonth 跨年', () => {
  expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  expect(shiftMonth('2026-12', 1)).toBe('2027-01');
});

test('formatToday 中文格式', () => {
  expect(formatToday(new Date(2026, 6, 8))).toBe('7月8日 周三');
});

describe('formatRelativeWorkoutDate', () => {
  test('同一自然周显示本周几，上一自然周显示上周几', () => {
    expect(formatRelativeWorkoutDate('2026-07-25', '2026-07-26')).toBe('本周六');
    expect(formatRelativeWorkoutDate('2026-07-15', '2026-07-26')).toBe('上周三');
  });

  test('超过上一自然周，同年直接显示月日，跨年补年份', () => {
    expect(formatRelativeWorkoutDate('2026-07-03', '2026-07-26')).toBe('7月3日');
    expect(formatRelativeWorkoutDate('2025-12-28', '2026-07-26')).toBe('2025年12月28日');
  });

  test('周一边界：前一天周日属于上一自然周', () => {
    expect(formatRelativeWorkoutDate('2026-07-19', '2026-07-20')).toBe('上周日');
  });
});
