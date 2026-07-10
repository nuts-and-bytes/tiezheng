import { resetDb } from '../test/dbTestUtils';
import { addCustomExercise, removeExercise, seedPresets } from '../repos/exerciseRepo';
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

test('csvEscape 公式注入前导字符加单引号前缀（OWASP CSV Injection）', () => {
  expect(csvEscape('=1+1')).toBe("'=1+1");
  expect(csvEscape('+86')).toBe("'+86");
  expect(csvEscape('-2')).toBe("'-2");
  expect(csvEscape('@SUM(A1)')).toBe("'@SUM(A1)");
});

test('buildWorkoutCsv 端到端：公式注入动作名被加前缀', async () => {
  const ex = await addCustomExercise('=1+1', 'chest');
  await addWorkoutItem('2026-07-08', ex.id, [{ weight: 60, reps: 10 }]);
  const csv = await buildWorkoutCsv();
  expect(csv.split('\n')[1]).toBe("2026-07-08,'=1+1,chest,1,60,10");
});

test('软删除动作后历史 CSV 行仍显示原动作名', async () => {
  const ex = await addCustomExercise('自创划船', 'back');
  await addWorkoutItem('2026-07-08', ex.id, [{ weight: 40, reps: 12 }]);
  await removeExercise(ex.id);
  const csv = await buildWorkoutCsv();
  expect(csv.split('\n')[1]).toBe('2026-07-08,自创划船,back,1,40,12');
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
