import type { Exercise } from './types';
import { defaultRailDate, monthRailDays, summarizeRailDay } from './calendar';

const EXERCISES = new Map<string, Exercise>([
  ['chest', { id: 'chest', name: '卧推', bodyPart: 'chest', preset: true, updatedAt: 0, deletedAt: null }],
  ['back', { id: 'back', name: '划船', bodyPart: 'back', preset: true, updatedAt: 0, deletedAt: null }],
  ['leg', { id: 'leg', name: '深蹲', bodyPart: 'leg', preset: true, updatedAt: 0, deletedAt: null }],
  ['assist', { id: 'assist', name: '辅助引体', bodyPart: 'back', loadMode: 'assistance', preset: true, updatedAt: 0, deletedAt: null }],
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

describe('summarizeRailDay', () => {
  const items = [
    { date: '2026-07-03', exerciseId: 'back', sets: [{ reps: 10 }, {}] },
    { date: '2026-07-03', exerciseId: 'chest', sets: [{ weight: 60, reps: 10 }] },
    { date: '2026-07-03', exerciseId: 'chest', sets: [{ weight: 70 }, {}] },
    { date: '2026-07-03', exerciseId: 'assist', sets: [{ weight: 30, reps: 8 }] },
    { date: '2026-07-04', exerciseId: 'leg', sets: [{ weight: 100, reps: 5 }] },
  ];

  test('保留全部部位并按固定部位顺序，合并同动作且保留首次出现顺序', () => {
    expect(summarizeRailDay('2026-07-03', items, EXERCISES)).toEqual({
      date: '2026-07-03',
      parts: ['chest', 'back'],
      moves: 3,
      sets: 6,
      volumeKg: 600,
      exercises: [
        { exerciseId: 'back', name: '划船', sets: 2 },
        { exerciseId: 'chest', name: '卧推', sets: 3 },
        { exerciseId: 'assist', name: '辅助引体', sets: 1 },
      ],
    });
  });

  test('只有辅助重量或字段不足时容量为 null，不伪造 0kg', () => {
    expect(summarizeRailDay('2026-07-03', [
      { date: '2026-07-03', exerciseId: 'back', sets: [{ reps: 10 }] },
      { date: '2026-07-03', exerciseId: 'assist', sets: [{ weight: 20, reps: 8 }] },
    ], EXERCISES).volumeKg).toBeNull();
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

  test('混合训练日在数据层保留全部部位，视觉层再自行限制颜色段', () => {
    const mixed = monthRailDays('2026-07', items, EXERCISES)
      .find((day) => day.date === '2026-07-03');

    expect(mixed).toMatchObject({ trained: true, sets: 6, parts: ['back', 'chest', 'leg'] });
  });
});
