import {
  countByBodyPart, currentStreak, maxWeightSeries, movingAverage, totals, weekProgress, weeklyCounts,
} from './stats';
import {
  PROGRESSION_POINTS,
  compare,
  dailyLoad,
  dailyMovingAverage,
  dailyPartBreakdown,
  dailyPartLoad,
  daysBetween,
  daysInRange,
  daysInYear,
  e1rmSeries,
  estimate1RM,
  hasWeightData,
  heatMonthLabels,
  heatWeekStarts,
  lastTrainedByBodyPart,
  longestStreak,
  percentile,
  prevRangeOf,
  prsByExercise,
  rangeOf,
  recentE1rmSeries,
  setsByBodyPart,
  topExerciseIds,
  yearsWithData,
} from './stats';
import type { Exercise } from './types';

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

test('totals 统计天数/组数/次数/容量（容量只算重量×次数齐全的组）', () => {
  const r = totals(
    [
      { sets: [{ weight: 60, reps: 10 }, { weight: 60, reps: 8 }] }, // 600+480
      { sets: [{ weight: 0, reps: 10 }, { reps: 12 }] },             // 0 + 无重量
    ],
    ['2026-07-01', '2026-07-02', '2026-07-01'],
  );
  expect(r).toEqual({ days: 2, sets: 4, reps: 40, volumeKg: 1080 });
});

/**
 * 容量 = 重量 × 次数，所以纯自重训练者的容量恒为 0 —— 但他并没有练了个寂寞。
 * 他挣来的负荷是**次数**。这一维必须能独立取到，否则「我的」页只能给他摆一个 42px 的 0。
 */
test('totals：纯自重也数得出负荷——次数照算，容量诚实归零', () => {
  const r = totals(
    [
      { sets: [{ reps: 20 }, { reps: 18 }] }, // 俯卧撑，一次重量都没填
      { sets: [{ weight: 40 }] },             // 只填重量没填次数：两边都不算
    ],
    ['2026-07-01'],
  );
  expect(r.reps).toBe(38);
  expect(r.volumeKg).toBe(0);
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

/** 测试夹具：两个动作，胸推 + 深蹲 */
const EX: Map<string, Exercise> = new Map([
  ['e1', { id: 'e1', name: '卧推', bodyPart: 'chest', preset: true, updatedAt: 0, deletedAt: null }],
  ['e2', { id: 'e2', name: '深蹲', bodyPart: 'leg', preset: true, updatedAt: 0, deletedAt: null }],
]);

const ITEMS = [
  { date: '2026-07-01', exerciseId: 'e1', sets: [{ weight: 60, reps: 10 }, { weight: 60, reps: 8 }] },
  { date: '2026-07-03', exerciseId: 'e1', sets: [{ weight: 65, reps: 8 }] },
  { date: '2026-07-03', exerciseId: 'e2', sets: [{ weight: 80, reps: 5 }, { weight: 80, reps: 5 }, { weight: 80, reps: 5 }] },
  { date: '2026-06-20', exerciseId: 'e1', sets: [{ weight: 50, reps: 10 }] },
];

describe('rangeOf / prevRangeOf', () => {
  it('本周从周一到今天', () => {
    // 2026-07-12 是周日 → 周一是 07-06
    expect(rangeOf('week', '2026-07-12')).toEqual({ from: '2026-07-06', to: '2026-07-12' });
  });

  it('本月从 1 号到今天', () => {
    expect(rangeOf('month', '2026-07-12')).toEqual({ from: '2026-07-01', to: '2026-07-12' });
  });

  it('今年从 1 月 1 日到今天', () => {
    expect(rangeOf('year', '2026-07-12')).toEqual({ from: '2026-01-01', to: '2026-07-12' });
  });

  it('全部从纪元起算', () => {
    expect(rangeOf('all', '2026-07-12')).toEqual({ from: '1970-01-01', to: '2026-07-12' });
  });

  it('周日打开（本周已走完）时，上一区间正好是完整的上一周', () => {
    // 2026-07-12 是周日 → cur = 07-06..07-12（整周）→ prev = 上一整周
    // 这是唯一一个「同相位」与旧的「紧邻等长窗口」重合的时刻；周中打开就会分道扬镳，
    // 见下面 prevRangeOf 的同相位用例。
    expect(prevRangeOf('week', '2026-07-12')).toEqual({ from: '2026-06-29', to: '2026-07-05' });
  });
});

describe('daysBetween / daysInRange / daysInYear', () => {
  it('daysBetween 算头尾差值', () => {
    expect(daysBetween('2026-07-01', '2026-07-12')).toBe(11);
    expect(daysBetween('2026-07-12', '2026-07-12')).toBe(0);
  });

  it('daysInRange 去重且只数区间内的', () => {
    const dates = ['2026-07-01', '2026-07-03', '2026-07-03', '2026-06-20'];
    expect(daysInRange(dates, '2026-07-01', '2026-07-12')).toBe(2);
  });

  it('daysInYear 认得闰年', () => {
    expect(daysInYear(2026)).toBe(365);
    expect(daysInYear(2024)).toBe(366);
  });
});

describe('hasWeightData', () => {
  it('有重量+次数才算有', () => {
    expect(hasWeightData(ITEMS)).toBe(true);
  });

  it('只记组数的用户算没有', () => {
    expect(hasWeightData([{ date: '2026-07-01', exerciseId: 'e1', sets: [{}, {}, {}] }])).toBe(false);
  });

  it('只填重量不填次数也算没有（容量算不出来）', () => {
    expect(
      hasWeightData([{ date: '2026-07-01', exerciseId: 'e1', sets: [{ weight: 60 }] }]),
    ).toBe(false);
  });

  // weight: 0 是合法输入（自重：引体、俯卧撑），validLoad(0) === true。
  // 但 0 既算不出容量（0×reps=0）也算不出 e1RM（Epley 乘的就是 weight）。
  // 判 `!== undefined` 会把自重当成「有重量数据」，于是顶部大数字显示无意义的「0 kg 容量」，
  // 力量趋势还会把自重动作选成主角、画出一张永远空着的图。口径必须是 weight > 0。
  it('自重（重量记 0）算没有重量数据——0 既没有容量也没有 1RM', () => {
    expect(
      hasWeightData([{ date: '2026-07-01', exerciseId: 'p-pullup', sets: [{ weight: 0, reps: 10 }] }]),
    ).toBe(false);
  });

  it('自重与配重混着练，只要有一组带重量就算有', () => {
    expect(
      hasWeightData([
        { date: '2026-07-01', exerciseId: 'p-pullup', sets: [{ weight: 0, reps: 10 }] },
        { date: '2026-07-02', exerciseId: 'p-bench', sets: [{ weight: 60, reps: 8 }] },
      ]),
    ).toBe(true);
  });
});

describe('topExerciseIds', () => {
  it('自重动作不进榜——它画不出 e1RM 曲线，选它当主角只会得到一张空图', () => {
    const items = [
      // 引体练了 3 天（自重），卧推只练了 2 天
      { date: '2026-07-01', exerciseId: 'p-pullup', sets: [{ weight: 0, reps: 10 }] },
      { date: '2026-07-02', exerciseId: 'p-pullup', sets: [{ weight: 0, reps: 10 }] },
      { date: '2026-07-03', exerciseId: 'p-pullup', sets: [{ weight: 0, reps: 10 }] },
      { date: '2026-07-04', exerciseId: 'p-bench', sets: [{ weight: 60, reps: 8 }] },
      { date: '2026-07-05', exerciseId: 'p-bench', sets: [{ weight: 62.5, reps: 8 }] },
    ];
    expect(topExerciseIds(items, 5)).toEqual(['p-bench']);
  });

  it('按有 e1RM 数据的训练日数降序（名副其实）', () => {
    const items = [
      { date: '2026-07-01', exerciseId: 'p-bench', sets: [{ weight: 60, reps: 8 }] },
      { date: '2026-07-02', exerciseId: 'p-bench', sets: [{ weight: 60, reps: 8 }] },
      { date: '2026-07-01', exerciseId: 'p-squat', sets: [{ weight: 100, reps: 5 }] },
    ];
    expect(topExerciseIds(items, 5)).toEqual(['p-bench', 'p-squat']);
  });
});

describe('dailyLoad', () => {
  it('按日期汇总组数，区间外不计', () => {
    const load = dailyLoad(ITEMS, '2026-07-01', '2026-07-12');
    expect(load.get('2026-07-01')).toBe(2);
    expect(load.get('2026-07-03')).toBe(4); // e1 一组 + e2 三组
    expect(load.has('2026-06-20')).toBe(false);
  });
});

describe('compare', () => {
  it('环比给出本期、上期和百分比', () => {
    const dates = ITEMS.map((i) => i.date);
    const r = compare(
      ITEMS,
      dates,
      { from: '2026-07-01', to: '2026-07-12' },
      { from: '2026-06-19', to: '2026-06-30' },
    );
    expect(r.days.cur).toBe(2);
    expect(r.days.prev).toBe(1);
    expect(r.days.pct).toBe(100);
    expect(r.sets.cur).toBe(6);
    expect(r.sets.prev).toBe(1);
  });

  it('上期为 0 时百分比为 null（不能除以 0，也不能写成 +Infinity%）', () => {
    const r = compare(ITEMS, ['2026-07-01'], { from: '2026-07-01', to: '2026-07-12' }, { from: '2026-06-01', to: '2026-06-12' });
    expect(r.days.prev).toBe(0);
    expect(r.days.pct).toBeNull();
  });
});

describe('estimate1RM', () => {
  it('Epley 公式', () => {
    expect(estimate1RM(100, 1)).toBeCloseTo(103.33, 1);
    expect(estimate1RM(60, 10)).toBeCloseTo(80, 5);
  });

  it('非法输入返回 0，不返回 NaN', () => {
    expect(estimate1RM(0, 10)).toBe(0);
    expect(estimate1RM(60, 0)).toBe(0);
  });
});

describe('prsByExercise', () => {
  it('每个动作取历史最佳 e1RM，按 e1RM 降序', () => {
    const prs = prsByExercise(ITEMS, EX);
    expect(prs[0].name).toBe('深蹲'); // 80×5 → 93.3
    expect(prs[0].e1rm).toBeCloseTo(93.33, 1);
    expect(prs[1].name).toBe('卧推'); // 65×8 → 82.3 胜过 60×10 的 80
    expect(prs[1].date).toBe('2026-07-03');
  });

  it('没有重量数据时返回空数组，不返回 NaN 行', () => {
    expect(prsByExercise([{ date: '2026-07-01', exerciseId: 'e1', sets: [{}] }], EX)).toEqual([]);
  });
});

describe('e1rmSeries / topExerciseIds', () => {
  it('每天取该动作最大 e1RM，按日期升序', () => {
    const s = e1rmSeries(ITEMS, 'e1');
    expect(s.map((p) => p.date)).toEqual(['2026-06-20', '2026-07-01', '2026-07-03']);
    expect(s[2].e1rm).toBeCloseTo(82.33, 1);
  });

  it('默认动作 = 有效数据点最多的那个（不再是 Map 迭代顺序里随机的第一个）', () => {
    expect(topExerciseIds(ITEMS, 5)[0]).toBe('e1'); // e1 有 3 天，e2 只有 1 天
  });
});

describe('recentE1rmSeries（进步曲线：脱离范围切换器，永远看最近 N 次）', () => {
  it('取该动作最近 N 次记录，日期升序', () => {
    // e1 共 3 天：06-20 / 07-01 / 07-03，取最近 2 次 → 07-01、07-03
    const s = recentE1rmSeries(ITEMS, 'e1', 2);
    expect(s.map((p) => p.date)).toEqual(['2026-07-01', '2026-07-03']);
  });

  it('记录不足 N 次时全给（1 次也给 1 个点，让 UI 自己决定怎么降级）', () => {
    const s = recentE1rmSeries(ITEMS, 'e2', 12);
    expect(s).toHaveLength(1);
    expect(s[0].date).toBe('2026-07-03');
    expect(s[0].e1rm).toBeCloseTo(93.33, 1);
  });

  it('不混入别的动作，也不因为「本周只练过一次」而变空', () => {
    const s = recentE1rmSeries(ITEMS, 'e1', PROGRESSION_POINTS);
    expect(s).toHaveLength(3); // 全时段 3 次，跟「本周」没关系
    expect(s.every((p) => p.e1rm > 0)).toBe(true);
  });

  it('没有重量数据的动作返回空数组', () => {
    const s = recentE1rmSeries([{ date: '2026-07-01', exerciseId: 'e1', sets: [{}] }], 'e1', 12);
    expect(s).toEqual([]);
  });

  it('limit <= 0 按 1 处理，绝不返回空（空图表就是骗人）', () => {
    expect(recentE1rmSeries(ITEMS, 'e1', 0)).toHaveLength(1);
  });

  it('默认进步曲线取 12 次', () => {
    expect(PROGRESSION_POINTS).toBe(12);
  });
});

describe('heatWeekStarts / heatMonthLabels（年度热力图的列与月份轴）', () => {
  it('从 1/1 所在周的周一排到 12/31 所在周的周一', () => {
    const cols = heatWeekStarts(2026); // 2026-01-01 是周四 → 2025-12-29
    expect(cols[0]).toBe('2025-12-29');
    expect(cols.at(-1)).toBe('2026-12-28'); // 2026-12-31 是周四
    expect(cols).toHaveLength(53);
  });

  it('月份标签落在「该月 1 号所在的那一列」，其余列为 null', () => {
    const cols = heatWeekStarts(2026);
    const labels = heatMonthLabels(cols, 2026);
    expect(labels).toHaveLength(cols.length);
    // 12 个月一个不能少，且升序
    expect(labels.filter((m): m is number => m !== null)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    // 1 月落在第一列（那一列同时含 2025-12-29 和 2026-01-01）
    expect(labels[0]).toBe(1);
    // 2026-07-01 是周三，所在周的周一是 2026-06-29
    expect(labels[cols.indexOf('2026-06-29')]).toBe(7);
  });

  it('跨年的边界列不会把上一年的月份标进来', () => {
    const cols = heatWeekStarts(2026);
    const labels = heatMonthLabels(cols, 2026);
    // 第一列含 2025-12-29..2025-12-31，但 12 月只能标在 2026 年的 12 月那列
    expect(labels[0]).toBe(1);
    expect(labels.lastIndexOf(12)).toBeGreaterThan(40);
  });
});

describe('setsByBodyPart / lastTrainedByBodyPart', () => {
  it('按部位汇总组数（组数计权，不是次数计权）', () => {
    const by = setsByBodyPart(ITEMS, EX);
    expect(by.chest).toBe(4);
    expect(by.leg).toBe(3);
    expect(by.back).toBe(0);
  });

  it('距上次训练天数；从未练过为 null', () => {
    const last = lastTrainedByBodyPart(ITEMS, EX, '2026-07-12');
    expect(last.chest).toBe(9); // 07-03
    expect(last.back).toBeNull();
  });
});

describe('longestStreak', () => {
  it('最长连续打卡天数', () => {
    expect(longestStreak(['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-06'])).toBe(3);
  });

  it('空数组为 0', () => {
    expect(longestStreak([])).toBe(0);
  });

  it('重复日期不重复计数', () => {
    expect(longestStreak(['2026-07-01', '2026-07-01', '2026-07-02'])).toBe(2);
  });
});

/**
 * 它原本只吐**一个**主练部位——于是格子只能涂一个色，练了胸 18 + 背 18 的那天
 * 和只练了胸的那天长得一模一样。渲染层想画出「练了两块」，数据层根本没给它。
 *
 * 现在带回全部部位（主练在前）。「一格至多涂两块」是**视觉**决策，归 heat.ts 的
 * cellParts 管；数据层不替渲染层做截断——年度图的 tooltip 要念全部，筛选器也要能
 * 命中「那天也练了臂，只是胸更多」的日子。
 */
describe('dailyPartLoad', () => {
  it('每天给出当天练到的全部部位（主练在前）和总组数', () => {
    const m = dailyPartLoad(ITEMS, EX);
    expect(m.get('2026-07-03')).toEqual({ parts: ['leg', 'chest'], sets: 4 }); // 腿 3 组 > 胸 1 组
    expect(m.get('2026-07-01')).toEqual({ parts: ['chest'], sets: 2 });
  });

  it('并列时取 BODY_PARTS 顺序靠前者（结果必须确定，不能靠 Map 迭代顺序）', () => {
    const tie = [
      { date: '2026-07-05', exerciseId: 'e2', sets: [{}] }, // leg 1 组
      { date: '2026-07-05', exerciseId: 'e1', sets: [{}] }, // chest 1 组
    ];
    expect(dailyPartLoad(tie, EX).get('2026-07-05')).toEqual({
      parts: ['chest', 'leg'],
      sets: 2,
    });
  });
});

/**
 * 年度热力图的格子是 9px 见方，部位**只**编码在色相里。七个色相挤进 9px：
 * 红绿色盲（男性约 8%）看 chest #E8483F / cardio #8FAE9B / arm #2FD6C3 三者高度趋同，
 * 读到的信息量是零；而说实话，七个色相在 9px 上谁都分不清。颜色只配当冗余通道，
 * 真相得另有一条文字通道 + 一条可交互的筛选通道。
 *
 * 而这两条通道都需要先有真相：dailyPartLoad 只给「主练部位」，一天里练到的次要部位
 * 它直接丢了。于是 tooltip 说不全，按部位筛选也会漏掉「那天也练了臂，只是胸更多」的日子。
 */
describe('dailyPartBreakdown', () => {
  it('一天练了几个部位就列几个，按组数降序', () => {
    expect(dailyPartBreakdown(ITEMS, EX).get('2026-07-03')).toEqual([
      { part: 'leg', sets: 3 },
      { part: 'chest', sets: 1 },
    ]);
  });

  it('并列时按 BODY_PARTS 顺序——和 dailyPartLoad 同一套决胜规则', () => {
    const tie = [
      { date: '2026-07-05', exerciseId: 'e2', sets: [{}] },
      { date: '2026-07-05', exerciseId: 'e1', sets: [{}] },
    ];
    expect(dailyPartBreakdown(tie, EX).get('2026-07-05')).toEqual([
      { part: 'chest', sets: 1 },
      { part: 'leg', sets: 1 },
    ]);
  });

  it('部位列表 = 明细的部位序列，总组数 = 明细之和（两个函数不许各说各话）', () => {
    const brk = dailyPartBreakdown(ITEMS, EX);
    const load = dailyPartLoad(ITEMS, EX);
    expect([...brk.keys()].sort()).toEqual([...load.keys()].sort());
    for (const [date, rows] of brk) {
      expect(load.get(date)).toEqual({
        parts: rows.map((r) => r.part),
        sets: rows.reduce((s, r) => s + r.sets, 0),
      });
    }
  });
});

describe('percentile', () => {
  it('p90 线性插值：(n-1)*p/100 = 8.1 → 9 + (10-9)*0.1 = 9.1', () => {
    // 计划里写的 toBe(10) 与它自己的实现（和 numpy / Excel PERCENTILE.INC）矛盾。
    // p90 若等于最大值就失去了意义——它存在的目的正是「别让某一天的暴走把热力图色阶冲淡」。
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBeCloseTo(9.1, 5);
  });

  it('分位落在整数下标上时直接取该值', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([5, 1, 3], 100)).toBe(5); // 内部先排序，不假设入参有序
  });

  it('空数组为 0（海报热力图靠它防 0 除）', () => {
    expect(percentile([], 90)).toBe(0);
  });
});

describe('yearsWithData', () => {
  it('降序返回有数据的年份', () => {
    expect(yearsWithData(['2025-12-31', '2026-01-01', '2026-07-01'])).toEqual([2026, 2025]);
  });
});

describe('dailyMovingAverage', () => {
  it('按自然日开窗，不按记录序号（隔了 30 天的两条不该互相平滑）', () => {
    const out = dailyMovingAverage(
      [
        { date: '2026-06-01', value: 70 },
        { date: '2026-07-01', value: 80 },
        { date: '2026-07-02', value: 82 },
      ],
      7,
    );
    expect(out[0].value).toBe(70);
    expect(out[1].value).toBe(80); // 7 日窗内只有它自己，不该被 6-01 的 70 拖下来
    expect(out[2].value).toBe(81); // (80+82)/2
  });
});

// ---- J · 环比：跟「上周同一时刻的我」比，而不是跟「上周的尾巴」比 ----

/**
 * 旧实现：prev = 紧挨着 cur 的等长窗口。周三打开时 cur = 周一–周三，
 * prev 就成了**上周五–上周日** —— 拿这周的周中训练日去比上周的周末休息日。
 * 后果：一个作息完全没变的人，环比数字随「今天是周几」剧烈震荡，红色下降箭头
 * 全是噪声。而环比存在的唯一理由，就是回答「我最近是不是在退步」。
 *
 * 正确的对照组是**上一周期的同一相位**：week-to-date 比 上周同一天为止。
 */
test('prevRangeOf：周对周，是上周的同一段，不是上周的尾巴', () => {
  // 2026-07-17 是周五；本周从 7/13（周一）起 → cur = 7/13–7/17
  expect(prevRangeOf('week', '2026-07-17')).toEqual({ from: '2026-07-06', to: '2026-07-10' });
});

test('prevRangeOf：月对月 / 年对年同样相位对齐', () => {
  expect(prevRangeOf('month', '2026-07-10')).toEqual({ from: '2026-06-01', to: '2026-06-10' });
  expect(prevRangeOf('year', '2026-03-05')).toEqual({ from: '2025-01-01', to: '2025-03-05' });
});

/** 月末的越界要夹住：3/31 的对照相位落在 2 月，不能算到 3 月去 */
test('prevRangeOf：3/31 的上一月对照夹在 2 月内，不溢出', () => {
  const prev = prevRangeOf('month', '2026-03-31');
  expect(prev).toEqual({ from: '2026-02-01', to: '2026-02-28' });
});

/**
 * 这是 J 真正的伤害：作息**完全没变**的人被告知自己在退步。
 * 每周一/三/五练。周五打开 —— 他这周练了 3 天，上周同期也练了 3 天。
 * 环比该是 0%，而旧实现拿上周三–上周日去比，只数出 2 天 → ↓33%。
 */
test('作息零变化的人，环比就是 0%（不该因为「今天是周五」而变成下降）', () => {
  const dates = [
    '2026-07-06', '2026-07-08', '2026-07-10', // 上周一三五
    '2026-07-13', '2026-07-15', '2026-07-17', // 本周一三五
  ];
  const items = dates.map((date) => ({ date, exerciseId: 'p-bench', sets: [{ weight: 60, reps: 10 }] }));
  const today = '2026-07-17';
  const cur = rangeOf('week', today);

  const cmp = compare(items, dates, cur, prevRangeOf('week', today));
  expect(cmp.days.cur).toBe(3);
  expect(cmp.days.prev).toBe(3);
  expect(cmp.days.pct).toBe(0);
});

// ---- I · Epley 在高次数区间不成立 ----

/**
 * Epley：1RM = w × (1 + reps/30)。它在低次数区间（≤10–12）才站得住。
 * 无上限时，60kg×30 推出 120kg，直接顶掉这个人真实做到的 100kg×1（e1RM 103.3）——
 * PR 榜的头名成了一组耐力训练。榜单本该回答「我最强的一次」。
 *
 * 修法是**在公式里封顶、不外推**（>12 次按 12 次算），而不是把高次数组判 0 剔除：
 * hasWeightData / topExerciseIds / e1rmSeries 共用「有重量」这一个口径，
 * 一旦某组「有重量但 e1RM = 0」，就会重新长出「被选成主角却画不出点」的空图。
 * 封顶还是保守方向：宁可低估，绝不让一组 30 次的假 PR 骑在真 PR 头上。
 */
test('Epley 在 12 次处封顶，不向高次数区间外推', () => {
  expect(estimate1RM(100, 1)).toBeCloseTo(103.33, 1);
  expect(estimate1RM(60, 12)).toBeCloseTo(84, 5);
  expect(estimate1RM(60, 30)).toBeCloseTo(84, 5); // 按 12 次估，不再推出 120
  expect(estimate1RM(60, 100)).toBeCloseTo(84, 5);
});

test('每一组带重量的记录仍产生正的 e1RM（不许长回空图根因）', () => {
  expect(estimate1RM(60, 30)).toBeGreaterThan(0);
  expect(estimate1RM(0, 10)).toBe(0); // 自重：weight 0 算不出 e1RM，这是另一回事
});

test('PR 榜：60kg×30 的耐力组顶不掉真实的 100kg×1', () => {
  const exMap = new Map([
    ['p-bench', { id: 'p-bench', name: '卧推', bodyPart: 'chest', preset: true, updatedAt: 0, deletedAt: null }],
  ] as const) as unknown as Parameters<typeof prsByExercise>[1];

  const rows = prsByExercise(
    [
      { date: '2026-07-01', exerciseId: 'p-bench', sets: [{ weight: 60, reps: 30 }] },
      { date: '2026-07-08', exerciseId: 'p-bench', sets: [{ weight: 100, reps: 1 }] },
    ],
    exMap,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].weight).toBe(100);
  expect(rows[0].reps).toBe(1);
});

// ---- K · compare 一直算着 reps 却把它丢了 ----

/**
 * totals() 早就有 reps 维度（D12 给「我的」页加的），compare() 却只往外传
 * days / sets / volumeKg —— 纯自重训练者唯一有意义的负荷维度，在数据页被丢在门口。
 */
test('compare 输出 reps 环比：自重训练者的负荷维度不能被丢掉', () => {
  const items = [
    { date: '2026-07-06', exerciseId: 'p-pushup', sets: [{ reps: 20 }, { reps: 20 }] },
    { date: '2026-07-13', exerciseId: 'p-pushup', sets: [{ reps: 25 }, { reps: 25 }] },
  ];
  const dates = ['2026-07-06', '2026-07-13'];
  const today = '2026-07-13';

  const cmp = compare(items, dates, rangeOf('week', today), prevRangeOf('week', today));
  expect(cmp.reps.cur).toBe(50);
  expect(cmp.reps.prev).toBe(40);
  expect(cmp.reps.pct).toBe(25);
});
