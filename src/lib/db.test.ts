import { db } from './db';
import { resetDb } from '../test/dbTestUtils';

beforeEach(resetDb);

test('六张表齐全', () => {
  expect(db.tables.map((t) => t.name).sort()).toEqual(
    ['exercises', 'photos', 'profile', 'weightLogs', 'workoutItems', 'workouts'],
  );
});

test('写入并读回一条训练', async () => {
  await db.workouts.add({ id: 'w1', date: '2026-07-08', updatedAt: 1, deletedAt: null });
  const row = await db.workouts.get('w1');
  expect(row?.date).toBe('2026-07-08');
});

test('date/updatedAt 二级索引可查询', async () => {
  await db.workouts.add({ id: 'w1', date: '2026-07-07', note: 'a', updatedAt: 1, deletedAt: null });
  await db.workouts.add({ id: 'w2', date: '2026-07-08', note: 'b', updatedAt: 2, deletedAt: null });

  const byDate = await db.workouts.where('date').equals('2026-07-08').toArray();
  expect(byDate.map((w) => w.id)).toEqual(['w2']);

  const byUpdatedAt = await db.workouts.where('updatedAt').above(1).toArray();
  expect(byUpdatedAt.map((w) => w.id)).toEqual(['w2']);
});
