import { cellParts } from './heat';
import { BODY_PARTS } from '../data/bodyParts';
import { datesOfMonth } from './dates';
import { dailyPartBreakdown, percentile, type ExMap, type LoadItem } from './stats';
import { loadModeOf, type BodyPart } from './types';

const EMPTY_TICK_HEIGHT = 8;
const MIN_TRAINED_HEIGHT = 18;

export interface MonthRailDay {
  date: string;
  day: number;
  trained: boolean;
  sets: number;
  parts: BodyPart[];
  heightPct: number;
  anchorLabel?: string;
}

export interface RailDaySummary {
  date: string;
  parts: BodyPart[];
  moves: number;
  sets: number;
  volumeKg: number | null;
  exercises: { exerciseId: string; name: string; sets: number }[];
}

/** 当前月选今天以前的最近训练日；历史月选月末最近一天；未来月不预选。 */
export function defaultRailDate(ym: string, workoutDates: string[], today: string): string | null {
  const currentYm = today.slice(0, 7);
  if (ym > currentYm) return null;
  const candidates = [...new Set(workoutDates)]
    .filter((date) => date.startsWith(`${ym}-`) && (ym < currentYm || date <= today))
    .sort((a, b) => b.localeCompare(a));
  return candidates[0] ?? null;
}

/** 把一个自然月投影为可水平浏览的训练轨道。 */
export function monthRailDays(ym: string, items: LoadItem[], exMap: ExMap): MonthRailDay[] {
  const dates = datesOfMonth(ym);
  const breakdown = dailyPartBreakdown(
    items.filter((item) => item.date.startsWith(`${ym}-`)),
    exMap,
  );
  const trainedSetCounts = [...breakdown.values()].map((rows) => (
    rows.reduce((total, row) => total + row.sets, 0)
  ));
  const ceiling = Math.max(percentile(trainedSetCounts, 90), 1);
  const lastDay = dates.length;

  return dates.map((date, index) => {
    const day = index + 1;
    const rows = breakdown.get(date) ?? [];
    const sets = rows.reduce((total, row) => total + row.sets, 0);
    const trained = sets > 0;
    const anchor = day === 1 || day === 8 || day === 15 || day === 22 || day === lastDay;
    return {
      date,
      day,
      trained,
      sets,
      parts: trained ? cellParts(rows.map((row) => row.part)) : [],
      heightPct: trained
        ? Math.max(MIN_TRAINED_HEIGHT, (Math.min(sets, ceiling) / ceiling) * 100)
        : EMPTY_TICK_HEIGHT,
      ...(anchor ? { anchorLabel: String(day) } : {}),
    };
  });
}

/** 选中日明细：完整部位、合并后的动作与真实可计算容量。 */
export function summarizeRailDay(date: string, items: LoadItem[], exMap: ExMap): RailDaySummary {
  const partSet = new Set<BodyPart>();
  const exerciseRows = new Map<string, { exerciseId: string; name: string; sets: number }>();
  let sets = 0;
  let volumeKg = 0;
  let hasVolume = false;

  for (const item of items) {
    if (item.date !== date) continue;
    const exercise = exMap.get(item.exerciseId);
    if (!exercise) continue;
    partSet.add(exercise.bodyPart);
    sets += item.sets.length;

    const current = exerciseRows.get(exercise.id);
    if (current) current.sets += item.sets.length;
    else exerciseRows.set(exercise.id, { exerciseId: exercise.id, name: exercise.name, sets: item.sets.length });

    if (loadModeOf(exercise) !== 'external') continue;
    for (const set of item.sets) {
      if (!(set.weight !== undefined && set.weight > 0 && set.reps !== undefined && set.reps > 0)) continue;
      volumeKg += set.weight * set.reps;
      hasVolume = true;
    }
  }

  return {
    date,
    parts: BODY_PARTS.map((part) => part.id).filter((part) => partSet.has(part)),
    moves: exerciseRows.size,
    sets,
    volumeKg: hasVolume ? volumeKg : null,
    exercises: [...exerciseRows.values()],
  };
}
