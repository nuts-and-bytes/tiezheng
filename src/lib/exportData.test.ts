import { resetDb } from '../test/dbTestUtils';
import { seedPresets } from '../repos/exerciseRepo';
import { addWorkoutItem } from '../repos/workoutRepo';
import { buildJsonExport, buildWorkoutCsv, csvEscape } from './exportData';

beforeEach(async () => {
  await resetDb();
  await seedPresets();
});

test('csvEscape 处理逗号/引号/换行', () => {
  expect(csvEscape('plain')).toBe('plain');
  expect(csvEscape('a,b')).toBe('"a,b"');
  expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
});

test('buildWorkoutCsv 每组一行、空值留空', async () => {
  await addWorkoutItem('2026-07-08', 'p-bench', [{ weight: 60, reps: 10 }, {}]);
  const csv = await buildWorkoutCsv();
  const lines = csv.split('\n');
  expect(lines[0]).toBe('date,exercise,body_part,set,weight_kg,reps');
  expect(lines[1]).toBe('2026-07-08,卧推,chest,1,60,10');
  expect(lines[2]).toBe('2026-07-08,卧推,chest,2,,');
});

test('buildJsonExport 含全部表（照片除外）', async () => {
  await addWorkoutItem('2026-07-08', 'p-bench', [{}]);
  const json = JSON.parse(await buildJsonExport());
  expect(json.workouts).toHaveLength(1);
  expect(json.workoutItems).toHaveLength(1);
  expect(json.exercises).toHaveLength(40);
  expect(json.exportedAt).toBeTruthy();
  expect(json).not.toHaveProperty('photos');
});
