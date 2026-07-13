import { BODY_PARTS } from '../data/bodyParts';
import { addDays, parseDate, weekStartOf } from './dates';
import type { BodyPart, Exercise, SetEntry } from './types';

export function countByBodyPart(parts: BodyPart[]): Record<BodyPart, number> {
  const result = Object.fromEntries(BODY_PARTS.map((p) => [p.id, 0])) as Record<BodyPart, number>;
  for (const p of parts) result[p] += 1;
  return result;
}

export interface WeekCount {
  weekStart: string;
  count: number;
}

/** 近 N 周训练天数，按周一开头分桶，从旧到新 */
export function weeklyCounts(workoutDates: string[], weeks: number, today: string): WeekCount[] {
  const thisWeek = weekStartOf(today);
  const starts = Array.from({ length: weeks }, (_, i) => addDays(thisWeek, -7 * (weeks - 1 - i)));
  const bucket = new Map(starts.map((s) => [s, 0]));
  for (const d of new Set(workoutDates)) {
    const key = weekStartOf(d);
    if (bucket.has(key)) bucket.set(key, bucket.get(key)! + 1);
  }
  return starts.map((weekStart) => ({ weekStart, count: bucket.get(weekStart)! }));
}

/** 移动平均；前段不足窗口时按已有值平均（体重 7 日均线用）；window<=0 时按 1 处理 */
export function movingAverage(values: number[], window: number): number[] {
  const w = Math.max(1, window);
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - w + 1), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

/** 力量曲线：每个日期取该动作最大重量，无重量的组跳过 */
export function maxWeightSeries(
  items: { date: string; sets: SetEntry[] }[],
): { date: string; maxKg: number }[] {
  const byDate = new Map<string, number>();
  for (const item of items) {
    for (const set of item.sets) {
      if (set.weight === undefined) continue;
      const cur = byDate.get(item.date);
      if (cur === undefined || set.weight > cur) byDate.set(item.date, set.weight);
    }
  }
  return [...byDate.entries()]
    .map(([date, maxKg]) => ({ date, maxKg }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 累计大数字：容量 = Σ(重量×次数)，仅重量次数都填了才计入 */
/**
 * 容量 = 重量 × 次数，所以纯自重训练者的容量恒为 0 —— 但他并没有练了个寂寞。
 * reps 是他唯一挣得到的负荷维度，跟 volumeKg 平级返回，让调用方自己决定摆哪一个。
 */
export function totals(
  items: { sets: SetEntry[] }[],
  workoutDates: string[],
): { days: number; sets: number; reps: number; volumeKg: number } {
  let sets = 0;
  let reps = 0;
  let volumeKg = 0;
  for (const item of items) {
    sets += item.sets.length;
    for (const s of item.sets) {
      if (s.reps !== undefined) reps += s.reps;
      if (s.weight !== undefined && s.reps !== undefined) volumeKg += s.weight * s.reps;
    }
  }
  return { days: new Set(workoutDates).size, sets, reps, volumeKg };
}

/** 连续打卡天数：今天没练则从昨天起算（今天还没练不算断） */
export function currentStreak(dates: Set<string>, today: string): number {
  let cursor = dates.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (dates.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** 本周（周一起）训练天数，目标进度环用 */
export function weekProgress(workoutDates: string[], today: string): number {
  const start = weekStartOf(today);
  const end = addDays(start, 6);
  return new Set(workoutDates.filter((d) => d >= start && d <= end)).size;
}

// ---- 数据页 v2：按「用户想知道什么」倒推的纯函数 ----

/** stats 的输入统一用这个形状（= workoutRepo.RangeItem，此处独立声明避免 lib 反向依赖 repos） */
export interface LoadItem {
  date: string;
  exerciseId: string;
  sets: SetEntry[];
}

export type ExMap = Map<string, Exercise>;
export type Segment = 'week' | 'month' | 'year' | 'all';

export interface Range {
  from: string;
  to: string;
}

export interface Delta {
  cur: number;
  prev: number;
  /** prev 为 0 时为 null——不能除以 0，也不能显示 +Infinity% */
  pct: number | null;
}

const EPOCH = '1970-01-01';

export function rangeOf(seg: Segment, today: string): Range {
  if (seg === 'week') return { from: weekStartOf(today), to: today };
  if (seg === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (seg === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  return { from: EPOCH, to: today };
}

/** 相邻的等长上一区间（环比用） */
export function prevRangeOf(cur: Range): Range {
  const len = daysBetween(cur.from, cur.to) + 1;
  const to = addDays(cur.from, -1);
  return { from: addDays(to, -(len - 1)), to };
}

export function daysBetween(a: string, b: string): number {
  const ms = parseDate(b).getTime() - parseDate(a).getTime();
  return Math.round(ms / 86400000);
}

export function daysInRange(dates: string[], from: string, to: string): number {
  return new Set(dates.filter((d) => d >= from && d <= to)).size;
}

export function daysInYear(year: number): number {
  return daysBetween(`${year}-01-01`, `${year}-12-31`) + 1;
}

function inRange<T extends { date: string }>(items: T[], from: string, to: string): T[] {
  return items.filter((i) => i.date >= from && i.date <= to);
}

/**
 * 有没有可算容量的数据。只记「练了什么+几组」的用户返回 false → 全页降级为组数口径。
 *
 * 为什么是 `weight > 0` 而不是 `weight !== undefined`：weight: 0 是合法输入（自重动作——
 * 引体、俯卧撑，validLoad(0) === true）。但 0 既算不出容量（0×reps=0），也算不出 e1RM
 * （Epley 乘的就是 weight）。把自重当成"有重量数据"，只会让页面显示无意义的「0 kg 容量」
 * 和一条永远画不出来的力量曲线。
 */
export function hasWeightData(items: LoadItem[]): boolean {
  return items.some((i) => i.sets.some((s) => weighted(s.weight) && s.reps !== undefined));
}

/** 这组能不能产生非零的容量与 e1RM。全库判「有重量」只认这一个口径。 */
function weighted(w: number | undefined): w is number {
  return w !== undefined && w > 0;
}

/** date → 当天总组数（热力图深浅） */
export function dailyLoad(items: LoadItem[], from: string, to: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of inRange(items, from, to)) {
    m.set(i.date, (m.get(i.date) ?? 0) + i.sets.length);
  }
  return m;
}

function pct(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

export function compare(
  items: LoadItem[],
  dates: string[],
  cur: Range,
  prev: Range,
): { days: Delta; sets: Delta; volumeKg: Delta } {
  const a = totals(inRange(items, cur.from, cur.to), dates.filter((d) => d >= cur.from && d <= cur.to));
  const b = totals(inRange(items, prev.from, prev.to), dates.filter((d) => d >= prev.from && d <= prev.to));
  return {
    days: { cur: a.days, prev: b.days, pct: pct(a.days, b.days) },
    sets: { cur: a.sets, prev: b.sets, pct: pct(a.sets, b.sets) },
    volumeKg: { cur: a.volumeKg, prev: b.volumeKg, pct: pct(a.volumeKg, b.volumeKg) },
  };
}

/** Epley 估算 1RM。重量或次数缺失/非正 → 0（绝不返回 NaN，NaN 进 Chart.js 会画出断线） */
export function estimate1RM(weight: number, reps: number): number {
  if (!(weight > 0) || !(reps > 0)) return 0;
  return weight * (1 + reps / 30);
}

export interface PrRow {
  exerciseId: string;
  name: string;
  bodyPart: BodyPart;
  e1rm: number;
  weight: number;
  reps: number;
  date: string;
}

/** 每个动作的历史最佳 e1RM，按 e1RM 降序。抗稀疏：只要有一组带重量就有一行，永远画不出空图 */
export function prsByExercise(items: LoadItem[], exMap: ExMap): PrRow[] {
  const best = new Map<string, PrRow>();
  for (const item of items) {
    const ex = exMap.get(item.exerciseId);
    if (!ex) continue;
    for (const s of item.sets) {
      if (!weighted(s.weight) || s.reps === undefined) continue;
      const e1rm = estimate1RM(s.weight, s.reps);
      const cur = best.get(item.exerciseId);
      if (!cur || e1rm > cur.e1rm) {
        best.set(item.exerciseId, {
          exerciseId: item.exerciseId,
          name: ex.name,
          bodyPart: ex.bodyPart,
          e1rm,
          weight: s.weight,
          reps: s.reps,
          date: item.date,
        });
      }
    }
  }
  return [...best.values()].sort((a, b) => b.e1rm - a.e1rm);
}

/** 某动作每日最大 e1RM，日期升序 */
export function e1rmSeries(items: LoadItem[], exerciseId: string): { date: string; e1rm: number }[] {
  const byDate = new Map<string, number>();
  for (const item of items) {
    if (item.exerciseId !== exerciseId) continue;
    for (const s of item.sets) {
      // 与 topExerciseIds / hasWeightData 同一个口径（weighted）。三者必须一致，
      // 否则会出现「被选成主角、却一个点都画不出来」的动作 —— 那正是力量趋势空图的根因。
      if (!weighted(s.weight) || s.reps === undefined) continue;
      const e1rm = estimate1RM(s.weight, s.reps);
      const cur = byDate.get(item.date);
      if (cur === undefined || e1rm > cur) byDate.set(item.date, e1rm);
    }
  }
  return [...byDate.entries()]
    .map(([date, e1rm]) => ({ date, e1rm }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 进步曲线默认取多少次记录。12 次 ≈ 三个月的训练跨度，够看出趋势又不至于挤成一团 */
export const PROGRESSION_POINTS = 12;

/**
 * 某动作最近 N 次记录的 e1RM，日期升序。
 *
 * 为什么不复用「周/月/年」范围：进步曲线回答的是「我的卧推从 60 涨到 90 了吗」，
 * 这个问题天然属于全时段。绑在范围切换器上，默认「周」的用户只会剩 1 个点 → 空图。
 * 顶部三个大数字是周期汇总（「本周练了 4 天」有意义），进步曲线不是，两者不该共用一个开关。
 */
export function recentE1rmSeries(
  items: LoadItem[],
  exerciseId: string,
  limit: number,
): { date: string; e1rm: number }[] {
  const n = Math.max(1, Math.floor(limit));
  return e1rmSeries(items, exerciseId).slice(-n);
}

/** 年度热力图的列：从当年 1/1 所在周的周一，排到 12/31 所在周的周一 */
export function heatWeekStarts(year: number): string[] {
  const end = weekStartOf(`${year}-12-31`);
  const cols: string[] = [];
  for (let d = weekStartOf(`${year}-01-01`); d <= end; d = addDays(d, 7)) cols.push(d);
  return cols;
}

/**
 * 每一列的月份标签：该月 1 号落在哪一列就标在哪一列，其余列为 null。
 * 只认属于 year 的 1 号——首列常含上一年的 12 月尾巴，不能因此标出一个 12。
 */
export function heatMonthLabels(weekStarts: string[], year: number): (number | null)[] {
  const prefix = String(year);
  return weekStarts.map((start) => {
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      if (d.startsWith(prefix) && d.slice(8) === '01') return Number(d.slice(5, 7));
    }
    return null;
  });
}

/** 按「有 e1RM 数据的训练日数」降序的动作 id。默认动作靠它选，不再靠 Map 迭代顺序随机取 */
export function topExerciseIds(items: LoadItem[], limit: number): string[] {
  const days = new Map<string, Set<string>>();
  for (const item of items) {
    const usable = item.sets.some((s) => weighted(s.weight) && s.reps !== undefined);
    if (!usable) continue;
    if (!days.has(item.exerciseId)) days.set(item.exerciseId, new Set());
    days.get(item.exerciseId)!.add(item.date);
  }
  return [...days.entries()]
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id]) => id);
}

export function setsByBodyPart(items: LoadItem[], exMap: ExMap): Record<BodyPart, number> {
  const out = Object.fromEntries(BODY_PARTS.map((p) => [p.id, 0])) as Record<BodyPart, number>;
  for (const item of items) {
    const ex = exMap.get(item.exerciseId);
    if (!ex) continue;
    out[ex.bodyPart] += item.sets.length;
  }
  return out;
}

/** 距上次练该部位的天数；从未练过 → null（「背已经 12 天没练了」靠它） */
export function lastTrainedByBodyPart(
  items: LoadItem[],
  exMap: ExMap,
  today: string,
): Record<BodyPart, number | null> {
  const last = Object.fromEntries(BODY_PARTS.map((p) => [p.id, null])) as Record<
    BodyPart,
    number | null
  >;
  const latest = new Map<BodyPart, string>();
  for (const item of items) {
    const ex = exMap.get(item.exerciseId);
    if (!ex) continue;
    const cur = latest.get(ex.bodyPart);
    if (cur === undefined || item.date > cur) latest.set(ex.bodyPart, item.date);
  }
  for (const [part, date] of latest) last[part] = daysBetween(date, today);
  return last;
}

export function longestStreak(dates: string[]): number {
  const sorted = [...new Set(dates)].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev !== null && daysBetween(prev, d) === 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  return best;
}

export interface DayPartLoad {
  part: BodyPart;
  sets: number;
}

/** 每天的主练部位（组数最多者；并列取 BODY_PARTS 顺序靠前者）+ 当天总组数。
    日历格上色和年度海报热力图共用这一个函数——两处颜色规则必须完全一致 */
export function dailyPartLoad(items: LoadItem[], exMap: ExMap): Map<string, DayPartLoad> {
  const perDay = new Map<string, Map<BodyPart, number>>();
  for (const item of items) {
    const ex = exMap.get(item.exerciseId);
    if (!ex) continue;
    if (!perDay.has(item.date)) perDay.set(item.date, new Map());
    const bucket = perDay.get(item.date)!;
    bucket.set(ex.bodyPart, (bucket.get(ex.bodyPart) ?? 0) + item.sets.length);
  }
  const order = BODY_PARTS.map((p) => p.id);
  const out = new Map<string, DayPartLoad>();
  for (const [date, bucket] of perDay) {
    let winner: BodyPart | null = null;
    let total = 0;
    for (const [part, n] of bucket) {
      total += n;
      if (
        winner === null ||
        n > bucket.get(winner)! ||
        (n === bucket.get(winner)! && order.indexOf(part) < order.indexOf(winner))
      ) {
        winner = part;
      }
    }
    if (winner !== null) out.set(date, { part: winner, sets: total });
  }
  return out;
}

/** 线性插值分位数。空数组返回 0——海报热力图的 maxSets 靠它防 0 除 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** 有数据的年份，降序（海报年份切换器用） */
export function yearsWithData(dates: string[]): number[] {
  return [...new Set(dates.map((d) => Number(d.slice(0, 4))))].sort((a, b) => b - a);
}

/** 按自然日开窗的移动平均。
    旧的 movingAverage 按记录序号开窗——隔了 30 天的两次称重会被当成相邻点互相平滑，是 bug */
export function dailyMovingAverage(
  series: { date: string; value: number }[],
  windowDays: number,
): { date: string; value: number }[] {
  const w = Math.max(1, windowDays);
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((point, i) => {
    const from = addDays(point.date, -(w - 1));
    let sum = 0;
    let n = 0;
    for (let j = i; j >= 0; j--) {
      if (sorted[j].date < from) break;
      sum += sorted[j].value;
      n += 1;
    }
    return { date: point.date, value: sum / n };
  });
}
