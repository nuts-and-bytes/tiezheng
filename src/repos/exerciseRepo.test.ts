import { db } from '../lib/db';
import { loadModeOf } from '../lib/types';
import { resetDb } from '../test/dbTestUtils';
import {
  addCustomExercise, getExercisesByIds, listByPart, removeExercise, renameExercise,
  seedPresets, setExerciseLoadMode,
} from './exerciseRepo';
import { PRESET_EXERCISES } from '../data/presetExercises';
import { addWorkoutItem } from './workoutRepo';

beforeEach(resetDb);

test('seedPresets 幂等：跑两次仍是 42 条', async () => {
  await seedPresets();
  await seedPresets();
  expect(await db.exercises.count()).toBe(42);
});

test('已有 40 个预设的旧库会补齐辅助动作且不覆盖现有动作', async () => {
  const now = Date.now();
  const legacyPresets = PRESET_EXERCISES
    .filter((p) => p.id !== 'p-assisted-dip' && p.id !== 'p-assisted-pullup')
    .map((p) => ({
      id: p.id,
      name: p.id === 'p-bench' ? '用户保留的卧推名称' : p.name,
      bodyPart: p.bodyPart,
      preset: true,
      updatedAt: now,
      deletedAt: null,
    }));
  await db.exercises.bulkAdd(legacyPresets);

  await seedPresets();

  expect(await db.exercises.count()).toBe(42);
  const exercises = await getExercisesByIds(['p-bench', 'p-assisted-dip', 'p-assisted-pullup']);
  expect(exercises.get('p-bench')?.name).toBe('用户保留的卧推名称');
  expect(exercises.get('p-assisted-dip')?.loadMode).toBe('assistance');
  expect(exercises.get('p-assisted-pullup')?.loadMode).toBe('assistance');
});

test('listByPart 只返回该部位的有效动作', async () => {
  await seedPresets();
  const chest = await listByPart('chest');
  expect(chest).toHaveLength(7);
  expect(chest.every((e) => e.bodyPart === 'chest')).toBe(true);
});

test('新建/改名/软删自定义动作', async () => {
  const ex = await addCustomExercise('  龙门架下斜夹胸 ', 'chest');
  expect(ex.name).toBe('龙门架下斜夹胸');
  expect(ex.preset).toBe(false);

  await renameExercise(ex.id, '下斜夹胸');
  const map = await getExercisesByIds([ex.id]);
  expect(map.get(ex.id)?.name).toBe('下斜夹胸');

  await removeExercise(ex.id);
  expect(await listByPart('chest')).toHaveLength(0); // 未 seed，删掉后为空
  // 软删：行还在，仍能按 id 取到（供历史记录关联展示）
  expect((await getExercisesByIds([ex.id])).has(ex.id)).toBe(true);
});

test('自定义动作缺省为普通负重，也可显式创建为辅助重量', async () => {
  const external = await addCustomExercise('普通动作', 'chest');
  const assistance = await addCustomExercise('辅助动作', 'back', 'assistance');

  expect(external.loadMode).toBe('external');
  expect(assistance.loadMode).toBe('assistance');
  expect((await db.exercises.get(external.id))?.loadMode).toBe('external');
  expect((await db.exercises.get(assistance.id))?.loadMode).toBe('assistance');
  expect(loadModeOf({})).toBe('external');
});

test('预置和自定义动作都可修改重量类型，并更新 updatedAt', async () => {
  await seedPresets();
  const custom = await addCustomExercise('自定义辅助动作', 'back');
  await db.exercises.update('p-bench', { updatedAt: 1 });
  await db.exercises.update(custom.id, { updatedAt: 1 });

  await setExerciseLoadMode('p-bench', 'assistance');
  await setExerciseLoadMode(custom.id, 'assistance');

  const presetRow = await db.exercises.get('p-bench');
  const customRow = await db.exercises.get(custom.id);
  expect(presetRow?.loadMode).toBe('assistance');
  expect(customRow?.loadMode).toBe('assistance');
  expect(presetRow?.updatedAt).toBeGreaterThan(1);
  expect(customRow?.updatedAt).toBeGreaterThan(1);
});

test('修改动作重量类型不改动真实数据库中的历史 sets', async () => {
  await seedPresets();
  const expectedSets = [
    { weight: 60, reps: 10 },
    { weight: 65, reps: 8 },
  ];
  const item = await addWorkoutItem('2026-07-08', 'p-bench', expectedSets);
  expect((await db.workoutItems.get(item.id))?.sets).toEqual(expectedSets);

  await setExerciseLoadMode('p-bench', 'assistance');

  expect((await db.workoutItems.get(item.id))?.sets).toEqual(expectedSets);
});

test('修改不存在动作的重量类型安全 no-op', async () => {
  await expect(setExerciseLoadMode('missing-exercise', 'assistance')).resolves.toBeUndefined();
  expect(await db.exercises.get('missing-exercise')).toBeUndefined();
});

test('seedPresets 并发调用不抛错且仍是 42 条', async () => {
  await Promise.all([seedPresets(), seedPresets()]);
  expect(await db.exercises.count()).toBe(42);
});

test('预置动作不可改名/软删（静默 no-op）', async () => {
  await seedPresets();
  await renameExercise('p-bench', '改名尝试');
  await removeExercise('p-bench');
  const row = (await getExercisesByIds(['p-bench'])).get('p-bench');
  expect(row?.name).toBe('卧推');
  expect(row?.deletedAt).toBeNull();
});

test('listByPart 排序：预置按预置顺序在前，自定义排在预置之后', async () => {
  await seedPresets();
  const before = await listByPart('chest');
  expect(before[0]?.id).toBe('p-bench');
  expect(before[0]?.name).toBe('卧推');

  await addCustomExercise('自定义夹胸', 'chest');
  const after = await listByPart('chest');
  expect(after).toHaveLength(8);
  expect(after.slice(0, 7).every((e) => e.preset)).toBe(true);
  expect(after[7]?.name).toBe('自定义夹胸');
  expect(after[7]?.preset).toBe(false);
});
