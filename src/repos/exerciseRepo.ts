import { db } from '../lib/db';
import { newId } from '../lib/ids';
import type { BodyPart, Exercise, LoadMode } from '../lib/types';
import { PRESET_EXERCISES } from '../data/presetExercises';

const PRESET_ORDER = new Map(PRESET_EXERCISES.map((p, i) => [p.id, i]));

/** 补齐缺失的预置动作；事务保证并发调用幂等，且不覆盖已有动作 */
export async function seedPresets(): Promise<void> {
  await db.transaction('rw', db.exercises, async () => {
    const presetIds = PRESET_EXERCISES.map((p) => p.id);
    const existing = await db.exercises.bulkGet(presetIds);
    const now = Date.now();
    const missing = PRESET_EXERCISES
      .filter((_, index) => existing[index] === undefined)
      .map((p) => ({
        id: p.id,
        name: p.name,
        bodyPart: p.bodyPart,
        loadMode: p.loadMode,
        preset: true,
        updatedAt: now,
        deletedAt: null,
      }));
    if (missing.length > 0) await db.exercises.bulkAdd(missing);
  });
}

export async function listByPart(part: BodyPart): Promise<Exercise[]> {
  const rows = await db.exercises.where('bodyPart').equals(part).toArray();
  return rows
    .filter((e) => e.deletedAt === null)
    .sort((a, b) => {
      if (a.preset && b.preset) {
        return (PRESET_ORDER.get(a.id) ?? 0) - (PRESET_ORDER.get(b.id) ?? 0);
      }
      if (a.preset !== b.preset) return a.preset ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh');
    });
}

/** 含软删行：历史记录里被删动作仍需显示名字 */
export async function getExercisesByIds(ids: string[]): Promise<Map<string, Exercise>> {
  const rows = await db.exercises.bulkGet(ids);
  const map = new Map<string, Exercise>();
  for (const e of rows) if (e) map.set(e.id, e);
  return map;
}

export async function addCustomExercise(
  name: string,
  part: BodyPart,
  loadMode: LoadMode = 'external',
): Promise<Exercise> {
  const ex: Exercise = {
    id: newId(),
    name: name.trim(),
    bodyPart: part,
    loadMode,
    preset: false,
    updatedAt: Date.now(),
    deletedAt: null,
  };
  await db.exercises.add(ex);
  return ex;
}

export async function setExerciseLoadMode(id: string, loadMode: LoadMode): Promise<void> {
  await db.exercises.update(id, { loadMode, updatedAt: Date.now() });
}

/** 预置动作不可改名（静默 no-op，UI 对预置隐藏该入口） */
export async function renameExercise(id: string, name: string): Promise<void> {
  const ex = await db.exercises.get(id);
  if (!ex || ex.preset) return;
  await db.exercises.update(id, { name: name.trim(), updatedAt: Date.now() });
}

/** 预置动作不可软删（静默 no-op，UI 对预置隐藏该入口） */
export async function removeExercise(id: string): Promise<void> {
  const ex = await db.exercises.get(id);
  if (!ex || ex.preset) return;
  await db.exercises.update(id, { deletedAt: Date.now(), updatedAt: Date.now() });
}
