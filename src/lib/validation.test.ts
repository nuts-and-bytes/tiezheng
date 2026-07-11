import {
  LIMITS, sanitizeSets, validBodyWeight, validLoad, validReps, validSetCount,
} from './validation';

test('体重 20–300kg', () => {
  expect(validBodyWeight(20)).toBe(true);
  expect(validBodyWeight(300)).toBe(true);
  expect(validBodyWeight(19.9)).toBe(false);
  expect(validBodyWeight(300.1)).toBe(false);
  expect(validBodyWeight(NaN)).toBe(false);
});

test('组数 1–20 整数', () => {
  expect(validSetCount(1)).toBe(true);
  expect(validSetCount(20)).toBe(true);
  expect(validSetCount(0)).toBe(false);
  expect(validSetCount(21)).toBe(false);
  expect(validSetCount(2.5)).toBe(false);
});

test('重量 0–500kg，次数 1–100 整数', () => {
  expect(validLoad(0)).toBe(true);
  expect(validLoad(500)).toBe(true);
  expect(validLoad(-1)).toBe(false);
  expect(validLoad(501)).toBe(false);
  expect(validReps(1)).toBe(true);
  expect(validReps(100)).toBe(true);
  expect(validReps(0)).toBe(false);
  expect(validReps(3.5)).toBe(false);
});

test('sanitizeSets 剔除非法重量/次数', () => {
  expect(sanitizeSets([{ weight: 60, reps: 500 }])).toEqual([{ weight: 60 }]);
  expect(LIMITS.sets.max).toBe(20);
});

test('sanitizeSets 丢弃清洗后为空的组（默认三行留下的空行不入库）', () => {
  // 曾经空组 {} 入库导致「总组数」虚增（2 组显示 3 组）
  expect(
    sanitizeSets([{ weight: 60, reps: 10 }, { weight: 70, reps: 8 }, {}]),
  ).toEqual([{ weight: 60, reps: 10 }, { weight: 70, reps: 8 }]);
  expect(
    sanitizeSets([{ weight: 60, reps: 10 }, { weight: 9999, reps: 0 }, {}]),
  ).toEqual([{ weight: 60, reps: 10 }]);
});

test('sanitizeSets 全空时保留组数（徒手训练只记组数不记次数）', () => {
  expect(sanitizeSets([{}, {}, {}])).toEqual([{}, {}, {}]);
  expect(sanitizeSets([])).toEqual([]);
});
