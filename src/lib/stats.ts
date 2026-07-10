import { BODY_PARTS } from '../data/bodyParts';
import { addDays, weekStartOf } from './dates';
import type { BodyPart, SetEntry } from './types';

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

/** 移动平均；前段不足窗口时按已有值平均（体重 7 日均线用） */
export function movingAverage(values: number[], window: number): number[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
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
export function totals(
  items: { sets: SetEntry[] }[],
  workoutDates: string[],
): { days: number; sets: number; volumeKg: number } {
  let sets = 0;
  let volumeKg = 0;
  for (const item of items) {
    sets += item.sets.length;
    for (const s of item.sets) {
      if (s.weight !== undefined && s.reps !== undefined) volumeKg += s.weight * s.reps;
    }
  }
  return { days: new Set(workoutDates).size, sets, volumeKg };
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
