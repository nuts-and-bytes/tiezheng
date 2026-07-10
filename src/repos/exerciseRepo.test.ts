import { db } from '../lib/db';
import { resetDb } from '../test/dbTestUtils';
import {
  addCustomExercise, getExercisesByIds, listByPart, removeExercise, renameExercise, seedPresets,
} from './exerciseRepo';

beforeEach(resetDb);

test('seedPresets 幂等：跑两次仍是 40 条', async () => {
  await seedPresets();
  await seedPresets();
  expect(await db.exercises.count()).toBe(40);
});

test('listByPart 只返回该部位的有效动作', async () => {
  await seedPresets();
  const chest = await listByPart('chest');
  expect(chest).toHaveLength(6);
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

test('seedPresets 并发调用不抛错且仍是 40 条', async () => {
  await Promise.all([seedPresets(), seedPresets()]);
  expect(await db.exercises.count()).toBe(40);
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
  expect(after).toHaveLength(7);
  expect(after.slice(0, 6).every((e) => e.preset)).toBe(true);
  expect(after[6]?.name).toBe('自定义夹胸');
  expect(after[6]?.preset).toBe(false);
});
