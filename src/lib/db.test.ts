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
