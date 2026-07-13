import { resetDb } from '../test/dbTestUtils';
import { addCustomExercise, removeExercise, seedPresets } from '../repos/exerciseRepo';
import { addWorkoutItem, getDayItems, removeWorkoutItem } from '../repos/workoutRepo';
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

/**
 * 「删除即删除」。软删是实现细节，不是给用户的承诺 —— 他删掉的训练日不该在
 * 他发给教练、传网盘的备份文件里原样复活（还附带 deletedAt 时间戳）。
 * 同文件的 buildWorkoutCsv 早就 filter 了（:22/:27），JSON 这条路一个过滤都没有。
 */
test('buildJsonExport：软删的训练记录不复活', async () => {
  await addWorkoutItem('2026-07-08', 'p-bench', [{ weight: 60, reps: 10 }]);
  const [item] = await getDayItems('2026-07-08');
  await removeWorkoutItem(item.id);

  const json = JSON.parse(await buildJsonExport());
  expect(json.workoutItems).toHaveLength(0);
  expect(json.workouts).toHaveLength(0); // 当天最后一个动作被删 → workout 行一起软删
  expect(await buildJsonExport()).not.toContain('deletedAt');
});

/** 删掉的自定义动作名（「产后修复训练」这类）不该躺在备份文件里 */
test('buildJsonExport：软删且无历史引用的自定义动作不导出', async () => {
  const ex = await addCustomExercise('临时试的动作', 'back');
  await removeExercise(ex.id);

  const json = JSON.parse(await buildJsonExport());
  expect(json.exercises).toHaveLength(40); // 只剩 40 个预置
  expect(await buildJsonExport()).not.toContain('临时试的动作');
});

/**
 * 对抗式护栏：不许把软删过滤做成一刀切。
 * 历史记录靠 exerciseId 引用动作取名 —— 动作被删了但那天的训练还在，
 * 一刀切会让备份里的历史条目变成认不出名字的孤儿 ID（CSV 早就为此不过滤 exercises，见 :24）。
 */
test('buildJsonExport：软删但历史仍在引用的动作必须导出（引用完整性）', async () => {
  const ex = await addCustomExercise('自创划船', 'back');
  await addWorkoutItem('2026-07-08', ex.id, [{ weight: 40, reps: 12 }]);
  await removeExercise(ex.id);

  const json = JSON.parse(await buildJsonExport());
  expect(json.workoutItems).toHaveLength(1);
  expect(json.exercises.map((e: { name: string }) => e.name)).toContain('自创划船');
});

/**
 * note 是用户的私人文字。它留在**自己的**备份里是对的（数据主权），
 * 但这必须是一个被写下来、被测试钉住的决定，而不是 `...spread` 的副作用 ——
 * 否则下一个往 Workout 上加字段的人，会静默地把它送进用户分享出去的文件。
 */
test('buildJsonExport：导出字段是显式白名单，不是整行 dump', async () => {
  await addWorkoutItem('2026-07-08', 'p-bench', [{ weight: 60, reps: 10 }]);
  const json = JSON.parse(await buildJsonExport());

  expect(Object.keys(json.workouts[0]).sort()).toEqual(['date', 'id', 'note']);
  expect(Object.keys(json.workoutItems[0]).sort()).toEqual([
    'exerciseId', 'id', 'order', 'sets', 'workoutId',
  ]);
  expect(Object.keys(json.exercises[0]).sort()).toEqual(['bodyPart', 'id', 'name', 'preset']);
});
