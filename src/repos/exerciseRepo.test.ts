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
