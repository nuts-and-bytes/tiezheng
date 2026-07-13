import type { SetEntry } from './types';

/**
 * 一组训练读出来是什么。
 *
 * 写侧 sanitizeSets 的保留条件是 `weight !== undefined || reps !== undefined`（OR），
 * 所以「只填次数」和「只填重量」都是合法入库数据，读侧必须一视同仁地认。
 * 用 `!== undefined` 而不是真值判断：weight 为 0（辅助引体的配重）是有效输入。
 */
export function setLabel(s: SetEntry): string | null {
  if (s.weight !== undefined && s.reps !== undefined) return `${s.weight}×${s.reps}`;
  if (s.reps !== undefined) return `${s.reps}次`;
  if (s.weight !== undefined) return `${s.weight}kg`;
  return null;
}

export function setLabels(sets: SetEntry[]): string[] {
  return sets.map(setLabel).filter((s): s is string => s !== null);
}
