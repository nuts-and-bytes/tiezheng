import type { SetEntry } from './types';

export const LIMITS = {
  weightKg: { min: 20, max: 300 },
  sets: { min: 1, max: 20 },
  load: { min: 0, max: 500 },
  reps: { min: 1, max: 100 },
} as const;

export const validBodyWeight = (v: number): boolean =>
  Number.isFinite(v) && v >= LIMITS.weightKg.min && v <= LIMITS.weightKg.max;

export const validSetCount = (v: number): boolean =>
  Number.isInteger(v) && v >= LIMITS.sets.min && v <= LIMITS.sets.max;

export const validLoad = (v: number): boolean =>
  Number.isFinite(v) && v >= LIMITS.load.min && v <= LIMITS.load.max;

export const validReps = (v: number): boolean =>
  Number.isInteger(v) && v >= LIMITS.reps.min && v <= LIMITS.reps.max;

/**
 * 提交时清洗：非法的重量/次数直接丢弃；清洗后为空的组一并丢弃（默认三行
 * 留下的空行不入库，避免虚增总组数）。全空时保留组数——徒手训练允许只记
 * 组数不记次数。
 */
export function sanitizeSets(sets: SetEntry[]): SetEntry[] {
  const cleaned = sets.map((s) => {
    const out: SetEntry = {};
    if (s.weight !== undefined && validLoad(s.weight)) out.weight = s.weight;
    if (s.reps !== undefined && validReps(s.reps)) out.reps = s.reps;
    return out;
  });
  const nonEmpty = cleaned.filter((s) => s.weight !== undefined || s.reps !== undefined);
  return nonEmpty.length > 0 ? nonEmpty : cleaned;
}
