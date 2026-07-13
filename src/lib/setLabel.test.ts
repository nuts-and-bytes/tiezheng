import { setLabel, setLabels } from './setLabel';

/**
 * 写侧（validation.ts:34 sanitizeSets）保留一组的条件是
 * `weight !== undefined || reps !== undefined` —— **OR**。
 * 只填次数的组（俯卧撑 12 次，重量栏本来就没东西可填）是合法入库数据。
 * 读侧必须认它，否则用户填进去的次数就是只写不读。
 */
test('只填次数的组读作「12次」，不是消失', () => {
  expect(setLabel({ reps: 12 })).toBe('12次');
});

test('只填重量的组读作「60kg」', () => {
  expect(setLabel({ weight: 60 })).toBe('60kg');
});

test('两个都填读作「60×10」', () => {
  expect(setLabel({ weight: 60, reps: 10 })).toBe('60×10');
});

test('一个都没填的组没有内容可读', () => {
  expect(setLabel({})).toBeNull();
});

/**
 * 混合场景是这个 bug 最刺人的形态：4 组里 2 组填了重量，
 * 旧实现只列出 2 项，而页头的总组数照样写 4 —— 同一屏上两个数字打架。
 * 摘要项数必须等于「有内容的组数」。
 */
test('自重与负重混着记：每一组都读得出来，项数对得上组数', () => {
  const sets = [{ weight: 60, reps: 10 }, { weight: 60, reps: 8 }, { reps: 12 }, { reps: 10 }];
  expect(setLabels(sets)).toEqual(['60×10', '60×8', '12次', '10次']);
});

/** 对抗式护栏：别为了救 reps-only 把「只记组数、什么都不填」的兜底也一起改坏 */
test('全空的组不产生噪声项（「N 组」兜底仍然成立）', () => {
  expect(setLabels([{}, {}, {}])).toEqual([]);
});

/** weight 为 0 是合法输入（validation 的 min 就是 0），且 0 !== undefined —— 不许被真值判断吃掉 */
test('重量 0（如辅助引体的配重）不被当成没填', () => {
  expect(setLabel({ weight: 0, reps: 5 })).toBe('0×5');
  expect(setLabel({ weight: 0 })).toBe('0kg');
});
