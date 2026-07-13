import type { SetEntry } from './types';

export const LIMITS = {
  weightKg: { min: 20, max: 300 },
  sets: { min: 1, max: 20 },
  // 边界服务于「防手滑」（把日期 20260710 输进重量栏），不是替用户判断他举不举得动：
  // 腿举机压满片子 560kg 是健身房日常；跳绳/开合跳做 200–300 次很常见。
  load: { min: 0, max: 1000 },
  reps: { min: 1, max: 500 },
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

/**
 * 这一组里有没有「填了、但超出范围」的栏位。
 *
 * sanitizeSets 是最后一道防线（挡绕过 UI 的脏数据），但它只会**沉默地**丢弃 ——
 * 用户按了保存，app 假装他没填过那一栏。所以 UI 必须先在输入处拦住并说出来：
 * SetRows 用它标红，保存按钮用它禁用。
 *
 * 「什么都没填」不算填错（默认三行空白不该一片红）。
 */
export function hasOutOfRange(sets: SetEntry[]): boolean {
  return sets.some(
    (s) =>
      (s.weight !== undefined && !validLoad(s.weight)) ||
      (s.reps !== undefined && !validReps(s.reps)),
  );
}
