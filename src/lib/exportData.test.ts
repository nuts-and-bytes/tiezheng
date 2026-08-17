import Dexie from 'dexie';
import { resetDb } from '../test/dbTestUtils';
import {
  customFoodRow,
  mealEstimateRow,
  mealItemRow,
  mealPhotoRow,
  mealRow,
  nutritionPlanRow,
  presetFoodRow,
} from '../test/nutritionBackupFixtures';
import { addCustomExercise, removeExercise, seedPresets } from '../repos/exerciseRepo';
import { addWorkoutItem, getDayItems, removeWorkoutItem } from '../repos/workoutRepo';
import { DB_V4_STORES, db, type NutritionDb } from './db';
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
  expect(json.exercises).toHaveLength(42);
  expect(json.exportedAt).toBeTruthy();
  expect(json).not.toHaveProperty('photos');
});

test('buildJsonExport：顶层声明备份格式 v3', async () => {
  const json = JSON.parse(await buildJsonExport());
  expect(json.schemaVersion).toBe(3);
  expect(json.exportedAt).toEqual(expect.any(String));
});

test('buildJsonExport：一个只读事务读取全部九张可恢复表', async () => {
  const transaction = vi.spyOn(db, 'transaction');

  await buildJsonExport();

  expect(transaction).toHaveBeenCalledTimes(1);
  expect(transaction.mock.calls[0]?.[0]).toBe('r');
  expect(transaction.mock.calls[0]?.[1]).toEqual([
    db.workouts,
    db.workoutItems,
    db.exercises,
    db.weightLogs,
    db.profile,
    db.nutritionPlans,
    db.foods,
    db.meals,
    db.mealItems,
  ]);
});

test('buildJsonExport：含营养白名单但排除图片、候选、临时状态和内置目录资产', async () => {
  const privateDataUrl = 'data:image/png;base64,cHJpdmF0ZQ==';
  const customFood = Object.assign(customFoodRow(), { imageAsset: privateDataUrl });
  const presetFood = Object.assign(presetFoodRow(), { imageAsset: privateDataUrl });
  const estimate = {
    ...mealEstimateRow(),
    requestId: 'request:private',
    requestFingerprint: privateDataUrl,
    candidates: [
      {
        id: 'candidate:private',
        name: '候选食物',
        preparation: '未知',
        amountLow: 1,
        amountHigh: 2,
        unit: 'g' as const,
        catalogFoodId: null,
      },
    ],
    consent: {
      uploadBlobSha256: 'a'.repeat(64),
      requestId: 'request:private',
      providerPolicyVersion: 'private-policy',
      consentedAt: 1,
      expiresAt: 2,
    },
  };

  await db.nutritionPlans.add(nutritionPlanRow());
  await db.foods.bulkAdd([customFood, presetFood]);
  await db.meals.add(mealRow());
  await db.mealItems.add(mealItemRow());
  await db.photos.add({
    id: 'body-photo:private',
    date: '2026-08-14',
    blob: new Blob(['private-body-image']),
    size: 18,
    updatedAt: 1,
    deletedAt: null,
  });
  await db.mealPhotos.add(mealPhotoRow(new Blob(['private-meal-image'])));
  await db.mealEstimates.add(estimate);

  const exported = await buildJsonExport();
  const json = JSON.parse(exported);

  expect(json.nutritionPlans).toHaveLength(1);
  expect(json.foods.map((row: { id: string }) => row.id)).toEqual([
    'food:custom:tofu-bowl',
  ]);
  expect(json.foods[0]).not.toHaveProperty('imageAsset');
  expect(json.meals).toHaveLength(1);
  expect(json.mealItems).toHaveLength(1);
  expect(json).not.toHaveProperty('bodyPhotos');
  expect(json).not.toHaveProperty('photos');
  expect(json).not.toHaveProperty('mealPhotos');
  expect(json).not.toHaveProperty('mealEstimates');
  expect(exported).not.toMatch(/Blob|base64|data:image|private-(?:body|meal)-image/);
});

test('buildJsonExport：九表快照不会被第二连接的中途写入撕裂', async () => {
  const beforeFood = { ...customFoodRow(), name: '写入前食物' };
  const afterFood = { ...beforeFood, name: '写入后食物', updatedAt: 2 };
  const beforeProfile = {
    id: 'me',
    weeklyGoal: 4,
    nickname: '写入前昵称',
    onboarded: true,
    updatedAt: 1,
  };
  const afterProfile = { ...beforeProfile, nickname: '写入后昵称', updatedAt: 2 };
  await db.profile.put(beforeProfile);
  await db.foods.put(beforeFood);

  const second = new Dexie('tiezheng') as NutritionDb;
  second.version(4).stores(DB_V4_STORES);
  await second.open();

  let writePromise: Promise<void> | undefined;
  let exportSettled = false;
  let writeObservedExportSettled: boolean | undefined;
  let gateOutcome: 'written' | 'timeout' | undefined;
  const waitForWrite = (timeoutMs: number): Promise<'written' | 'timeout'> => {
    if (writePromise === undefined) throw new Error('测试写入尚未启动');
    const pending = writePromise;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => resolve('timeout'), timeoutMs);
      pending.then(
        () => {
          clearTimeout(timeout);
          resolve('written');
        },
        (error: unknown) => {
          clearTimeout(timeout);
          reject(error);
        },
      );
    });
  };

  const nutritionPlansToArray = db.nutritionPlans.toArray.bind(db.nutritionPlans);
  const readGate = vi.spyOn(db.nutritionPlans, 'toArray').mockImplementation(() => {
    writePromise ??= Dexie.ignoreTransaction(() =>
      second
        .transaction('rw', [second.profile, second.foods], () =>
          Promise.all([
            second.profile.put(afterProfile),
            second.foods.put(afterFood),
          ]).then(() => undefined),
        )
        .then(() => {
          writeObservedExportSettled = exportSettled;
        }),
    );
    return Dexie.Promise.resolve(Dexie.waitFor(waitForWrite(100))).then((outcome) => {
      gateOutcome = outcome;
      return nutritionPlansToArray();
    });
  });

  try {
    const json = JSON.parse(
      await buildJsonExport().finally(() => {
        exportSettled = true;
      }),
    );

    expect({
      nickname: json.profile[0]?.nickname,
      foodName: json.foods[0]?.name,
    }).toEqual({ nickname: '写入前昵称', foodName: '写入前食物' });
    expect(gateOutcome).toBe('timeout');
    expect(writePromise).toBeDefined();
    await expect(waitForWrite(1_000)).resolves.toBe('written');
    expect(writeObservedExportSettled).toBe(true);
    expect((await db.profile.get('me'))?.nickname).toBe('写入后昵称');
    expect((await db.foods.get(beforeFood.id))?.name).toBe('写入后食物');
  } finally {
    readGate.mockRestore();
    if (writePromise !== undefined) {
      await waitForWrite(1_000).catch(() => 'timeout' as const);
    }
    second.close();
  }
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
  expect(json.exercises).toHaveLength(42); // 只剩 42 个预置
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
  expect(json.exercises.find((e: { id: string }) => e.id === ex.id)).toMatchObject({
    archived: true,
  });
});

test('buildJsonExport：历史动作缺少重量类型时导出 external，辅助动作导出 assistance', async () => {
  const legacyBench = await db.exercises.get('p-bench');
  if (!legacyBench) throw new Error('测试预置动作缺失');
  delete legacyBench.loadMode;
  await db.exercises.put(legacyBench);

  const json = JSON.parse(await buildJsonExport());
  const loadModeById = new Map(
    json.exercises.map((exercise: { id: string; loadMode: string }) => [
      exercise.id,
      exercise.loadMode,
    ]),
  );
  expect(loadModeById.get('p-bench')).toBe('external');
  expect(loadModeById.get('p-assisted-dip')).toBe('assistance');
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
  expect(Object.keys(json.exercises[0]).sort()).toEqual([
    'archived', 'bodyPart', 'id', 'loadMode', 'name', 'preset',
  ]);
});
