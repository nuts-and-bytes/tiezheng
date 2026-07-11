import Dexie from 'dexie';
import { expect, test } from 'vitest';

// v1 时期 sanitizeSets 允许空组 {} 入库（默认三行的残留），虚增总组数。
// v2 迁移应对存量 workoutItems 重新清洗。
test('v2 迁移清洗存量数据中的空组', async () => {
  const old = new Dexie('tiezheng');
  old.version(1).stores({
    workouts: 'id, date, updatedAt',
    workoutItems: 'id, workoutId, exerciseId, updatedAt',
    exercises: 'id, bodyPart, updatedAt',
    weightLogs: 'id, date, updatedAt',
    photos: 'id, date, updatedAt',
    profile: 'id',
  });
  await old.open();
  await old.table('workouts').put({ id: 'w1', date: '2026-07-06', updatedAt: 1 });
  await old.table('workoutItems').put({
    id: 'i1',
    workoutId: 'w1',
    exerciseId: 'p-bench',
    sets: [{ weight: 60, reps: 10 }, { weight: 70, reps: 8 }, {}],
    updatedAt: 1,
  });
  await old.table('workoutItems').put({
    id: 'i2',
    workoutId: 'w1',
    exerciseId: 'p-pushup',
    sets: [{}, {}, {}], // 全空 = 徒手只记组数，保留
    updatedAt: 1,
  });
  old.close();

  const { db } = await import('./db');
  expect((await db.workoutItems.get('i1'))?.sets).toEqual([
    { weight: 60, reps: 10 },
    { weight: 70, reps: 8 },
  ]);
  expect((await db.workoutItems.get('i2'))?.sets).toEqual([{}, {}, {}]);
});
