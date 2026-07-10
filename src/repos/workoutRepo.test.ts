import { db } from '../lib/db';
import { resetDb } from '../test/dbTestUtils';
import { seedPresets } from './exerciseRepo';
import {
  addWorkoutItem, commitDraft, getDayItems, getOrCreateWorkout, listItemsInRange,
  listRecentExerciseIds, listWorkoutDates, removeWorkoutItem, updateItemSets,
} from './workoutRepo';

beforeEach(async () => {
  await resetDb();
  await seedPresets();
});

test('同一天只有一条 workout（getOrCreateWorkout 去重）', async () => {
  const a = await getOrCreateWorkout('2026-07-08');
  const b = await getOrCreateWorkout('2026-07-08');
  expect(a.id).toBe(b.id);
  expect(await db.workouts.count()).toBe(1);
});

test('addWorkoutItem 顺序递增；getDayItems 关联动作并按序返回', async () => {
  await addWorkoutItem('2026-07-08', 'p-bench', [{ weight: 60, reps: 10 }]);
  await addWorkoutItem('2026-07-08', 'p-squat', [{}, {}]);
  const items = await getDayItems('2026-07-08');
  expect(items.map((i) => i.order)).toEqual([0, 1]);
  expect(items.map((i) => i.exercise.bodyPart)).toEqual(['chest', 'leg']);
});

test('删光当天条目后，listWorkoutDates 不再含该日', async () => {
  const item = await addWorkoutItem('2026-07-08', 'p-bench', [{}]);
  await addWorkoutItem('2026-07-07', 'p-squat', [{}]);
  await removeWorkoutItem(item.id);
  expect(await listWorkoutDates('2026-07-01', '2026-07-31')).toEqual(['2026-07-07']);
});

test('updateItemSets 覆盖组数据', async () => {
  const item = await addWorkoutItem('2026-07-08', 'p-bench', [{}]);
  await updateItemSets(item.id, [{ weight: 70, reps: 5 }, { weight: 70, reps: 5 }]);
  const items = await getDayItems('2026-07-08');
  expect(items[0].sets).toHaveLength(2);
  expect(items[0].sets[0].weight).toBe(70);
});

test('commitDraft 跳过 0 组条目、按日期入库', async () => {
  await commitDraft(
    [
      { exerciseId: 'p-bench', sets: [{ weight: 60, reps: 10 }, {}] },
      { exerciseId: 'p-squat', sets: [] },
    ],
    '2026-07-08',
  );
  const items = await getDayItems('2026-07-08');
  expect(items).toHaveLength(1);
  expect(items[0].exercise.id).toBe('p-bench');
});

test('listItemsInRange 只含区间内有效条目并带日期', async () => {
  await addWorkoutItem('2026-07-01', 'p-bench', [{ weight: 60, reps: 10 }]);
  await addWorkoutItem('2026-06-30', 'p-squat', [{}]);
  const rows = await listItemsInRange('2026-07-01', '2026-07-31');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ date: '2026-07-01', exerciseId: 'p-bench' });
});

test('listRecentExerciseIds 去重且最近使用在前', async () => {
  await addWorkoutItem('2026-07-06', 'p-bench', [{}]);
  await new Promise((r) => setTimeout(r, 5)); // 确保 updatedAt 递增
  await addWorkoutItem('2026-07-07', 'p-squat', [{}]);
  await new Promise((r) => setTimeout(r, 5));
  await addWorkoutItem('2026-07-08', 'p-bench', [{}]);
  const ids = await listRecentExerciseIds();
  expect(ids.slice(0, 2)).toEqual(['p-bench', 'p-squat']);
});
