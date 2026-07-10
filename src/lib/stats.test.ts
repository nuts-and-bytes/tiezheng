import {
  countByBodyPart, currentStreak, maxWeightSeries, movingAverage, totals, weekProgress, weeklyCounts,
} from './stats';

test('countByBodyPart 零填充全部 7 个部位', () => {
  const r = countByBodyPart(['chest', 'chest', 'leg']);
  expect(r).toEqual({ chest: 2, shoulder: 0, back: 0, leg: 1, arm: 0, core: 0, cardio: 0 });
});

test('weeklyCounts 按周一开头分桶、从旧到新', () => {
  const r = weeklyCounts(['2026-07-06', '2026-07-07', '2026-06-30'], 2, '2026-07-08');
  expect(r).toEqual([
    { weekStart: '2026-06-29', count: 1 },
    { weekStart: '2026-07-06', count: 2 },
  ]);
});

test('movingAverage 前段不足窗口时按已有值平均', () => {
  expect(movingAverage([1, 2, 3, 4], 2)).toEqual([1, 1.5, 2.5, 3.5]);
});

test('movingAverage window 不合法时按 1 处理', () => {
  expect(movingAverage([1, 2, 3], 0)).toEqual([1, 2, 3]);
});

test('movingAverage 窗口大于数据长度时按已有值平均', () => {
  expect(movingAverage([1, 2], 7)).toEqual([1, 1.5]);
});

test('maxWeightSeries 取每日最大重量、跳过无重量组', () => {
  const r = maxWeightSeries([
    { date: '2026-07-01', sets: [{ weight: 60, reps: 10 }, { weight: 70, reps: 5 }, { reps: 12 }] },
  ]);
  expect(r).toEqual([{ date: '2026-07-01', maxKg: 70 }]);
});

test('maxWeightSeries 同日多条目合并取最大、无重量的天不产出点', () => {
  const r = maxWeightSeries([
    { date: '2026-07-01', sets: [{ weight: 60, reps: 10 }] },
    { date: '2026-07-01', sets: [{ weight: 80, reps: 5 }] },
    { date: '2026-07-02', sets: [{ reps: 12 }] },
  ]);
  expect(r).toEqual([{ date: '2026-07-01', maxKg: 80 }]);
});

test('totals 统计天数/组数/容量（容量只算重量×次数齐全的组）', () => {
  const r = totals(
    [
      { sets: [{ weight: 60, reps: 10 }, { weight: 60, reps: 8 }] }, // 600+480
      { sets: [{ weight: 0, reps: 10 }, { reps: 12 }] },             // 0 + 无重量
    ],
    ['2026-07-01', '2026-07-02', '2026-07-01'],
  );
  expect(r).toEqual({ days: 2, sets: 4, volumeKg: 1080 });
});

test('currentStreak：今天没练看昨天，断档归零', () => {
  expect(currentStreak(new Set(['2026-07-08', '2026-07-07', '2026-07-05']), '2026-07-08')).toBe(2);
  expect(currentStreak(new Set(['2026-07-07', '2026-07-06']), '2026-07-08')).toBe(2);
  expect(currentStreak(new Set(['2026-07-05']), '2026-07-08')).toBe(0);
});

test('currentStreak 空记录为 0、只有今天为 1', () => {
  expect(currentStreak(new Set(), '2026-07-08')).toBe(0);
  expect(currentStreak(new Set(['2026-07-08']), '2026-07-08')).toBe(1);
});

test('weekProgress 只数本周（周一起）', () => {
  expect(weekProgress(['2026-07-06', '2026-07-08', '2026-07-01'], '2026-07-08')).toBe(2);
});
