import { cellParts } from './heat';
import { datesOfMonth } from './dates';
import { dailyPartBreakdown, percentile, type ExMap, type LoadItem } from './stats';
import type { BodyPart } from './types';

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
