import {
  LIMITS, hasOutOfRange, sanitizeSets, validBodyWeight, validLoad, validReps, validSetCount,
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

/**
 * 边界服务于「防手滑」（把日期 20260710 输进重量栏），**不是替用户判断他举不举得动**。
 * 旧上限 500kg / 100 次是拍脑袋定的，会误杀真实训练值：
 * - 腿举机压满片子 560kg 是健身房日常（深蹲/硬拉世界纪录才 ~500kg，但腿举不是深蹲）
 * - 开合跳、跳绳、俯卧撑挑战做 200–300 次很常见
 * 而这些值一旦超范围，sanitizeSets 会**静默**把它剥掉 —— 用户按了保存，app 假装他没填过。
 */
test('重量 0–1000kg：腿举机压满片子是真实训练值，不是手滑', () => {
  expect(validLoad(0)).toBe(true); // 自重/辅助引体的配重
  expect(validLoad(560)).toBe(true); // 腿举机
  expect(validLoad(1000)).toBe(true);
  expect(validLoad(-1)).toBe(false);
  expect(validLoad(1001)).toBe(false);
  expect(validLoad(20260710)).toBe(false); // 日期串进重量栏 —— 边界真正要拦的东西
});

test('次数 1–500 整数：跳绳/开合跳做几百次是真实的', () => {
  expect(validReps(1)).toBe(true);
  expect(validReps(300)).toBe(true);
  expect(validReps(500)).toBe(true);
  expect(validReps(0)).toBe(false);
  expect(validReps(501)).toBe(false);
  expect(validReps(3.5)).toBe(false);
});

test('sanitizeSets 剔除非法重量/次数', () => {
  expect(sanitizeSets([{ weight: 60, reps: 9999 }])).toEqual([{ weight: 60 }]);
  expect(LIMITS.sets.max).toBe(20);
});

/**
 * sanitizeSets 是最后一道防线（挡绕过 UI 的脏数据），但它只会**沉默地**丢弃。
 * UI 必须先在输入处拦住并说出来 —— hasOutOfRange 就是给保存按钮用的那个判断。
 */
test('hasOutOfRange：填了东西但超出范围 → true，保存按钮该禁用', () => {
  expect(hasOutOfRange([{ weight: 60, reps: 10 }])).toBe(false);
  expect(hasOutOfRange([{}])).toBe(false); // 什么都没填不是「填错了」
  expect(hasOutOfRange([{ reps: 12 }])).toBe(false); // 只填次数是合法的
  expect(hasOutOfRange([{ weight: 0, reps: 5 }])).toBe(false); // 配重 0 合法

  expect(hasOutOfRange([{ weight: 20260710 }])).toBe(true);
  expect(hasOutOfRange([{ weight: 60, reps: 10 }, { weight: 9999, reps: 8 }])).toBe(true);
  expect(hasOutOfRange([{ reps: 0 }])).toBe(true);
  expect(hasOutOfRange([{ reps: 3.5 }])).toBe(true);
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
