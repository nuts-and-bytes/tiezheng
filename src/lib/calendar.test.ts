import type { Exercise } from './types';
import { defaultRailDate, monthRailDays } from './calendar';

const EXERCISES = new Map<string, Exercise>([
  ['chest', { id: 'chest', name: '卧推', bodyPart: 'chest', preset: true, updatedAt: 0, deletedAt: null }],
  ['back', { id: 'back', name: '划船', bodyPart: 'back', preset: true, updatedAt: 0, deletedAt: null }],
  ['leg', { id: 'leg', name: '深蹲', bodyPart: 'leg', preset: true, updatedAt: 0, deletedAt: null }],
]);

describe('defaultRailDate', () => {
  test('当前月选择不晚于今天的最近训练日', () => {
    expect(defaultRailDate('2026-07', ['2026-07-03', '2026-07-20', '2026-07-27'], '2026-07-26'))
      .toBe('2026-07-20');
  });

  test('历史月选择最后训练日，未来月或无记录返回 null', () => {
    expect(defaultRailDate('2026-06', ['2026-06-03', '2026-06-28'], '2026-07-26')).toBe('2026-06-28');
    expect(defaultRailDate('2026-08', ['2026-08-03'], '2026-07-26')).toBeNull();
    expect(defaultRailDate('2026-05', [], '2026-07-26')).toBeNull();
  });
});

describe('monthRailDays', () => {
  const items = [
    { date: '2026-07-03', exerciseId: 'chest', sets: [{}, {}] },
    { date: '2026-07-03', exerciseId: 'back', sets: [{}, {}, {}] },
    { date: '2026-07-03', exerciseId: 'leg', sets: [{}] },
    { date: '2026-07-20', exerciseId: 'chest', sets: Array.from({ length: 100 }, () => ({})) },
  ];

  test('返回整月刻度、定位标签与训练状态', () => {
    const days = monthRailDays('2026-07', items, EXERCISES);

    expect(days).toHaveLength(31);
    expect(days.filter((day) => day.anchorLabel).map((day) => day.day)).toEqual([1, 8, 15, 22, 31]);
    expect(days.find((day) => day.date === '2026-07-04')).toMatchObject({
      trained: false, sets: 0, parts: [], heightPct: 8,
    });
  });

  test('训练柱按当月 p90 封顶且保留可见最小高度', () => {
    const days = monthRailDays('2026-07', items, EXERCISES);
    const regular = days.find((day) => day.date === '2026-07-03')!;
    const extreme = days.find((day) => day.date === '2026-07-20')!;

    expect(regular.heightPct).toBeGreaterThanOrEqual(18);
    expect(extreme.heightPct).toBe(100);
  });

  test('混合训练日按稳定部位规则只保留前两个颜色段', () => {
    const mixed = monthRailDays('2026-07', items, EXERCISES)
      .find((day) => day.date === '2026-07-03');

    expect(mixed).toMatchObject({ trained: true, sets: 6, parts: ['back', 'chest'] });
  });
});
