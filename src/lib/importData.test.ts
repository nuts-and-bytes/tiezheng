import { Blob as NodeBlob } from 'node:buffer';
import Dexie from 'dexie';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DB_V4_STORES, db, type NutritionDb } from './db';
import { buildJsonExport } from './exportData';
import {
  MAX_BACKUP_BYTES,
  parseBackupFile,
  previewRestore,
  restoreBackup,
  type RestoreCandidate,
  type RestoreMode,
} from './importData';
import { addCustomExercise, removeExercise, seedPresets } from '../repos/exerciseRepo';
import { savePhoto } from '../repos/photoRepo';
import { getProfile, saveProfile } from '../repos/profileRepo';
import { addWorkoutItem, getDayItems, listAllWorkoutDates } from '../repos/workoutRepo';
import { setWeight } from '../repos/weightRepo';
import { resetDb } from '../test/dbTestUtils';
import {
  activePointNutritionPlanRow,
  customFoodRow,
  legacyBackupV0Fixture,
  legacyBackupV1Fixture,
  legacyBackupV2Fixture,
  mealEstimateRow,
  mealItemRow,
  mealPhotoRow,
  mealRow,
  nutritionBackupSectionFixture,
  nutritionPlanRow,
  presetFoodRow,
} from '../test/nutritionBackupFixtures';
import { serializeNutritionSection } from './nutritionBackup';

beforeAll(() => vi.stubGlobal('Blob', NodeBlob));
afterAll(() => vi.unstubAllGlobals());

function legacyBackup() {
  return {
    exportedAt: '2026-07-20T08:00:00.000Z',
    workouts: [{ id: 'w-1', date: '2026-07-18', note: '背部日' }],
    workoutItems: [
      {
        id: 'wi-1',
        workoutId: 'w-1',
        exerciseId: 'custom-row',
        order: 0,
        sets: [{ weight: 40, reps: 12 }, { reps: 10 }],
      },
    ],
    exercises: [
      {
        id: 'custom-row',
        name: '自创划船',
        bodyPart: 'back',
        preset: false,
        ignoredPrivateField: 'must-not-survive',
      },
    ],
    weightLogs: [{ id: 'weight-1', date: '2026-07-18', weightKg: 72.5 }],
    profile: [{ id: 'me', weeklyGoal: 4, nickname: '铁人', onboarded: true }],
  };
}

function fileOf(value: unknown, name = 'tiezheng-backup.json'): File {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return new File([text], name, { type: 'application/json' });
}

function legacyBackupForVersion(schemaVersion: 0 | 1 | 2) {
  if (schemaVersion === 0) return legacyBackupV0Fixture();
  if (schemaVersion === 1) return legacyBackupV1Fixture();
  return legacyBackupV2Fixture();
}

function v3Backup() {
  return {
    ...legacyBackupV2Fixture(),
    schemaVersion: 3 as const,
    ...nutritionBackupSectionFixture(),
  };
}

async function allTableSnapshot() {
  return Object.fromEntries(
    await Promise.all(db.tables.map(async (table) => [table.name, await table.toArray()] as const)),
  );
}

async function seedEveryTable() {
  await resetDb();
  await seedPresets();
  await addWorkoutItem('2026-07-17', 'p-squat', [{ weight: 100, reps: 5 }]);
  await setWeight('2026-07-17', 73);
  await saveProfile({ weeklyGoal: 3, nickname: '本机用户', onboarded: true });
  await savePhoto('2026-07-17', new Blob(['body-photo'], { type: 'image/jpeg' }));
  await db.nutritionPlans.add(nutritionPlanRow());
  await db.foods.add(customFoodRow());
  await db.meals.add(mealRow());
  await db.mealItems.add(mealItemRow());
  await db.mealPhotos.add(mealPhotoRow());
  await db.mealEstimates.add(mealEstimateRow());
}

describe('parseBackupFile', () => {
  test('兼容无 schemaVersion 和 loadMode 的旧备份，并生成恢复预览', async () => {
    const backup = legacyBackup();
    const candidate = await parseBackupFile(fileOf(backup));

    expect(candidate.schemaVersion).toBe(0);
    expect(candidate.data.exercises[0]).toEqual({
      id: 'custom-row',
      name: '自创划船',
      bodyPart: 'back',
      loadMode: 'external',
      preset: false,
      archived: false,
    });
    expect(candidate.preview).toEqual({
      exportedAt: backup.exportedAt,
      workoutDays: 1,
      exercises: 1,
      sets: 2,
      weightLogs: 1,
      nutritionPlans: 0,
      nutritionDays: 0,
      meals: 0,
      mealItems: 0,
    });
  });

  test.each([0, 1, 2] as const)('v%i 真实旧备份恢复为空营养段和零计数', async (schemaVersion) => {
    const backup = legacyBackupForVersion(schemaVersion);
    const candidate = await parseBackupFile(fileOf(backup));

    expect(candidate.schemaVersion).toBe(schemaVersion);
    expect(candidate.preview).toEqual({
      exportedAt: backup.exportedAt,
      workoutDays: 1,
      exercises: 1,
      sets: 2,
      weightLogs: 1,
      nutritionPlans: 0,
      nutritionDays: 0,
      meals: 0,
      mealItems: 0,
    });
    expect(candidate.data.nutritionPlans).toEqual([]);
    expect(candidate.data.foods).toEqual([]);
    expect(candidate.data.meals).toEqual([]);
    expect(candidate.data.mealItems).toEqual([]);
  });

  test('旧版候选的空营养数组彼此隔离，调用方变异不污染后续解析', async () => {
    const [v0, v1] = await Promise.all([
      parseBackupFile(fileOf(legacyBackupForVersion(0))),
      parseBackupFile(fileOf(legacyBackupForVersion(1))),
    ]);
    const nutritionKeys = ['nutritionPlans', 'foods', 'meals', 'mealItems'] as const;

    for (const key of nutritionKeys) {
      expect(v0.data[key]).not.toBe(v1.data[key]);
    }

    const v3 = await parseBackupFile(fileOf(v3Backup()));
    v0.data.meals.push(v3.data.meals[0]);
    const fresh = await parseBackupFile(fileOf(legacyBackupForVersion(2)));

    expect(fresh.data.meals).toEqual([]);
    expect(fresh.preview).toMatchObject({
      nutritionPlans: 0,
      nutritionDays: 0,
      meals: 0,
      mealItems: 0,
    });
  });

  test('v3 解析营养数据并生成精确营养预览', async () => {
    const backup = v3Backup();
    const candidate = await parseBackupFile(fileOf(backup));

    expect(candidate.schemaVersion).toBe(3);
    expect(candidate.preview).toEqual({
      exportedAt: backup.exportedAt,
      workoutDays: 1,
      exercises: 1,
      sets: 2,
      weightLogs: 1,
      nutritionPlans: 1,
      nutritionDays: 1,
      meals: 1,
      mealItems: 1,
    });
    expect(candidate.data.nutritionPlans).toHaveLength(1);
    expect(candidate.data.foods).toHaveLength(1);
    expect(candidate.data.meals).toEqual([
      { id: 'meal:2026-08-14:lunch', date: '2026-08-14', slot: 'lunch' },
    ]);
    expect(candidate.data.mealItems[0].id).toBe('meal-item:one');
  });

  test('越界 active 营养计划在解析阶段拒绝且数据库逐表不变', async () => {
    const malicious = v3Backup();
    malicious.nutritionPlans = serializeNutritionSection({
      nutritionPlans: [activePointNutritionPlanRow()],
      foods: [],
      meals: [],
      mealItems: [],
    }).nutritionPlans;
    malicious.nutritionPlans[0].safetyInputs.ageYears = 121;
    await db.nutritionPlans.add(nutritionPlanRow());
    const before = await tableSnapshot();

    await expect(parseBackupFile(fileOf(malicious))).rejects.toThrow('年龄超出范围');
    expect(await tableSnapshot()).toEqual(before);
  });

  test('Task 3 生成的 v3 JSON 可进入候选与预览，解析过程不改数据库', async () => {
    await seedEveryTable();
    const exported = await buildJsonExport();
    const before = await allTableSnapshot();

    const candidate = await parseBackupFile(fileOf(exported));

    expect(candidate.schemaVersion).toBe(3);
    expect(candidate.preview).toMatchObject({
      nutritionPlans: 1,
      nutritionDays: 1,
      meals: 1,
      mealItems: 1,
    });
    expect(candidate.data.foods).toHaveLength(1);
    expect(await allTableSnapshot()).toEqual(before);
  });

  test.each([
    ['恶意未知字段', (backup: ReturnType<typeof v3Backup>) => {
      Object.assign(backup.meals[0], { privateFutureField: 'must-not-survive' });
    }],
    ['非法营养计划', (backup: ReturnType<typeof v3Backup>) => {
      backup.nutritionPlans[0].standardVersion = 'latest';
    }],
    ['断裂餐次引用', (backup: ReturnType<typeof v3Backup>) => {
      backup.mealItems[0].mealId = 'meal:2026-08-14:dinner';
    }],
    ['重复餐食条目 ID 碰撞', (backup: ReturnType<typeof v3Backup>) => {
      backup.mealItems.push(structuredClone(backup.mealItems[0]));
    }],
  ] as const)('v3 %s 时整份解析失败且所有数据库表不变', async (_label, mutate) => {
    await seedEveryTable();
    const before = await allTableSnapshot();
    const backup = v3Backup();
    mutate(backup);

    await expect(parseBackupFile(fileOf(backup))).rejects.toMatchObject({
      code: 'invalid-content',
    });
    expect(await allTableSnapshot()).toEqual(before);
  });

  test('v4 备份仍按未来版本拒绝', async () => {
    await expect(
      parseBackupFile(fileOf({ ...v3Backup(), schemaVersion: 4 })),
    ).rejects.toMatchObject({ code: 'future-version' });
  });

  test('保留当前备份中的辅助重量类型', async () => {
    const backup = legacyBackup();
    const current = {
      ...backup,
      schemaVersion: 2,
      exercises: [{ ...backup.exercises[0], loadMode: 'assistance', archived: false }],
    };

    const candidate = await parseBackupFile(fileOf(current));

    expect(candidate.schemaVersion).toBe(2);
    expect(candidate.data.exercises[0].loadMode).toBe('assistance');
  });

  test('兼容已发布但缺少 archived 的 v1 备份', async () => {
    const backup = legacyBackup();
    const v1 = {
      ...backup,
      schemaVersion: 1,
      exercises: [{ ...backup.exercises[0], loadMode: 'assistance' }],
    };

    const candidate = await parseBackupFile(fileOf(v1));

    expect(candidate.schemaVersion).toBe(1);
    expect(candidate.data.exercises[0]).toMatchObject({
      loadMode: 'assistance',
      archived: false,
    });
  });

  test('新版备份缺少 loadMode 时拒绝而不是静默降级', async () => {
    await expect(
      parseBackupFile(fileOf({ ...legacyBackup(), schemaVersion: 1 })),
    ).rejects.toMatchObject({ code: 'invalid-content' });
  });

  test('兼容最早期原始行备份，忽略实现字段且不复活软删记录', async () => {
    const legacy = legacyBackup();
    const earliest = {
      ...legacy,
      workouts: [
        { ...legacy.workouts[0], updatedAt: 1, deletedAt: null },
        { id: 'w-deleted', date: '2026-07-17', updatedAt: 1, deletedAt: 2 },
      ],
      workoutItems: [
        { ...legacy.workoutItems[0], updatedAt: 1, deletedAt: null },
        {
          id: 'wi-deleted',
          workoutId: 'w-deleted',
          exerciseId: 'custom-deleted',
          order: 0,
          sets: [{}],
          updatedAt: 1,
          deletedAt: 2,
        },
      ],
      exercises: [
        { ...legacy.exercises[0], updatedAt: 1, deletedAt: null },
        {
          id: 'custom-deleted',
          name: '已删除动作',
          bodyPart: 'back',
          preset: false,
          updatedAt: 1,
          deletedAt: 2,
        },
      ],
      weightLogs: [
        { ...legacy.weightLogs[0], updatedAt: 1, deletedAt: null },
        { id: 'weight-deleted', date: '2026-07-17', weightKg: 73, updatedAt: 1, deletedAt: 2 },
      ],
      profile: [{ id: 'me', weeklyGoal: 5, updatedAt: 1 }],
    };

    const candidate = await parseBackupFile(fileOf(earliest));

    expect(candidate.data.workouts.map((row) => row.id)).toEqual(['w-1']);
    expect(candidate.data.workoutItems.map((row) => row.id)).toEqual(['wi-1']);
    expect(candidate.data.exercises.map((row) => row.id)).toEqual(['custom-row']);
    expect(candidate.data.weightLogs.map((row) => row.id)).toEqual(['weight-1']);
    expect(candidate.data.profile).toEqual([
      { id: 'me', weeklyGoal: 5, onboarded: true },
    ]);
  });

  test('拒绝损坏的 JSON', async () => {
    await expect(parseBackupFile(fileOf('{bad json'))).rejects.toMatchObject({
      code: 'invalid-json',
    });
  });

  test('拒绝未来版本的备份', async () => {
    await expect(
      parseBackupFile(fileOf({ ...legacyBackup(), schemaVersion: 99 })),
    ).rejects.toMatchObject({ code: 'future-version' });
  });

  test('拒绝断裂的训练和动作引用', async () => {
    const broken = legacyBackup();
    broken.workoutItems[0].workoutId = 'missing-workout';

    await expect(parseBackupFile(fileOf(broken))).rejects.toMatchObject({
      code: 'invalid-content',
    });
  });

  test.each([
    ['非法日期', (backup: ReturnType<typeof legacyBackup>) => { backup.workouts[0].date = '2026-02-30'; }],
    ['重复训练日期', (backup: ReturnType<typeof legacyBackup>) => {
      backup.workouts.push({ id: 'w-2', date: '2026-07-18', note: '' });
    }],
    ['非法部位', (backup: ReturnType<typeof legacyBackup>) => {
      backup.exercises[0].bodyPart = 'whole-body';
    }],
    ['越界重量', (backup: ReturnType<typeof legacyBackup>) => {
      backup.workoutItems[0].sets[0].weight = 1001;
    }],
    ['重复 ID', (backup: ReturnType<typeof legacyBackup>) => {
      backup.workoutItems.push({ ...backup.workoutItems[0] });
    }],
  ])('拒绝%s', async (_label, mutate) => {
    const backup = legacyBackup();
    mutate(backup);
    await expect(parseBackupFile(fileOf(backup))).rejects.toMatchObject({
      code: 'invalid-content',
    });
  });

  test('拒绝超过 10 MB 的文件', async () => {
    const file = new File([new Uint8Array(MAX_BACKUP_BYTES + 1)], 'huge.json');
    await expect(parseBackupFile(file)).rejects.toMatchObject({
      code: 'file-too-large',
    });
  });
});

function twoDayBackup() {
  const backup = legacyBackup();
  backup.workouts.push({ id: 'w-2', date: '2026-07-19', note: '胸部日' });
  backup.workoutItems.push({
    id: 'wi-2',
    workoutId: 'w-2',
    exerciseId: 'p-bench',
    order: 0,
    sets: [{ weight: 80, reps: 8 }],
  });
  return backup;
}

function byId<T extends { id: string }>(rows: T[]): T[] {
  return rows.sort((left, right) => left.id.localeCompare(right.id));
}

async function tableSnapshot() {
  return db.transaction(
    'r',
    [
      db.workouts,
      db.workoutItems,
      db.exercises,
      db.weightLogs,
      db.photos,
      db.profile,
      db.nutritionPlans,
      db.foods,
      db.meals,
      db.mealItems,
      db.mealPhotos,
      db.mealEstimates,
    ],
    async () => ({
      workouts: byId(await db.workouts.toArray()),
      workoutItems: byId(await db.workoutItems.toArray()),
      exercises: byId(await db.exercises.toArray()),
      weightLogs: byId(await db.weightLogs.toArray()),
      photos: byId((await db.photos.toArray()).map(
        ({ id, date, size, updatedAt, deletedAt }) => ({ id, date, size, updatedAt, deletedAt }),
      )),
      profile: byId(await db.profile.toArray()),
      nutritionPlans: byId(await db.nutritionPlans.toArray()),
      foods: byId(await db.foods.toArray()),
      meals: byId(await db.meals.toArray()),
      mealItems: byId(await db.mealItems.toArray()),
      mealPhotos: byId((await db.mealPhotos.toArray()).map(
        ({ id, mealId, size, width, height, mealSnapshotHash, updatedAt }) => ({
          id,
          mealId,
          size,
          width,
          height,
          mealSnapshotHash,
          updatedAt,
        }),
      )),
      mealEstimates: byId(await db.mealEstimates.toArray()),
    }),
  );
}

async function restoreWithCurrentPreview(candidate: RestoreCandidate, mode: RestoreMode) {
  const preview = await previewRestore(candidate, mode);
  return restoreBackup(candidate, mode, {
    previewFingerprint: preview.fingerprint,
    allowPhotoDeletion: preview.mealPhotosToDelete > 0,
    allowEstimateDiscard: preview.mealEstimatesToDiscard > 0,
  });
}

async function bounded<T>(promise: Promise<T>, label: string, timeoutMs = 1_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label}超时`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function withSecondConnection(
  mutate: (second: NutritionDb) => Promise<unknown>,
): Promise<void> {
  const second = new Dexie('tiezheng') as NutritionDb;
  second.version(4).stores(DB_V4_STORES);
  await bounded(Promise.resolve(second.open()), '第二 Dexie 连接打开');
  try {
    await bounded(Promise.resolve(mutate(second)), '第二 Dexie 连接写入');
  } finally {
    second.close();
  }
}

describe('restoreBackup', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetDb();
    await seedPresets();
  });

  test('安全合并保留独有日期，以备份整体替换冲突日期且不改动照片', async () => {
    await addWorkoutItem('2026-07-17', 'p-squat', [{ weight: 100, reps: 5 }]);
    await addWorkoutItem('2026-07-18', 'p-bench', [{ weight: 60, reps: 10 }]);
    await setWeight('2026-07-17', 73);
    await setWeight('2026-07-18', 72.8);
    await savePhoto('2026-07-18', new Blob(['proof'], { type: 'image/jpeg' }));
    const candidate = await parseBackupFile(fileOf(twoDayBackup()));

    const result = await restoreWithCurrentPreview(candidate, 'merge');

    expect(result).toEqual({ workoutDays: 2, nutritionDays: 0 });
    expect(await listAllWorkoutDates()).toEqual(['2026-07-17', '2026-07-18', '2026-07-19']);
    const restoredConflictDay = await getDayItems('2026-07-18');
    expect(restoredConflictDay).toHaveLength(1);
    expect(restoredConflictDay[0].exercise.name).toBe('自创划船');
    expect(restoredConflictDay[0].sets).toEqual([{ weight: 40, reps: 12 }, { reps: 10 }]);
    expect((await db.weightLogs.where('date').equals('2026-07-18').toArray()))
      .toMatchObject([{ weightKg: 72.5, deletedAt: null }]);
    expect(await db.photos.count()).toBe(1);
  });

  test('重复合并同一备份不会制造重复记录', async () => {
    const candidate = await parseBackupFile(fileOf(twoDayBackup()));

    await restoreWithCurrentPreview(candidate, 'merge');
    await restoreWithCurrentPreview(candidate, 'merge');

    expect(await db.workouts.count()).toBe(2);
    expect(await db.workoutItems.count()).toBe(2);
    expect(await db.weightLogs.count()).toBe(1);
    expect(await db.exercises.where('id').equals('custom-row').count()).toBe(1);
  });

  test('安全合并拒绝跨日期的训练 ID 碰撞且不改动本机数据', async () => {
    await db.workouts.add({
      id: 'w-1',
      date: '2026-07-17',
      updatedAt: 1,
      deletedAt: null,
    });
    await db.workoutItems.add({
      id: 'local-item',
      workoutId: 'w-1',
      exerciseId: 'p-squat',
      order: 0,
      sets: [{ weight: 100, reps: 5 }],
      updatedAt: 1,
      deletedAt: null,
    });
    const before = await tableSnapshot();
    const candidate = await parseBackupFile(fileOf(legacyBackup()));

    await expect(restoreWithCurrentPreview(candidate, 'merge')).rejects.toMatchObject({
      code: 'invalid-content',
    });
    expect(await tableSnapshot()).toEqual(before);
  });

  test('安全合并拒绝非冲突日期的训练动作 ID 碰撞', async () => {
    await db.workouts.add({
      id: 'local-workout',
      date: '2026-07-17',
      updatedAt: 1,
      deletedAt: null,
    });
    await db.workoutItems.add({
      id: 'wi-1',
      workoutId: 'local-workout',
      exerciseId: 'p-squat',
      order: 0,
      sets: [{ weight: 100, reps: 5 }],
      updatedAt: 1,
      deletedAt: null,
    });
    const before = await tableSnapshot();
    const candidate = await parseBackupFile(fileOf(legacyBackup()));

    await expect(restoreWithCurrentPreview(candidate, 'merge')).rejects.toMatchObject({
      code: 'invalid-content',
    });
    expect(await tableSnapshot()).toEqual(before);
  });

  test('安全合并拒绝非冲突日期的体重 ID 碰撞', async () => {
    await db.weightLogs.add({
      id: 'weight-1',
      date: '2026-07-17',
      weightKg: 73,
      updatedAt: 1,
      deletedAt: null,
    });
    const before = await tableSnapshot();
    const candidate = await parseBackupFile(fileOf(legacyBackup()));

    await expect(restoreWithCurrentPreview(candidate, 'merge')).rejects.toMatchObject({
      code: 'invalid-content',
    });
    expect(await tableSnapshot()).toEqual(before);
  });

  test('旧备份不能把当前系统预设辅助动作降级', async () => {
    const backup = legacyBackup();
    const downgradedPreset = {
      id: 'p-assisted-pullup',
      name: '旧辅助引体',
      bodyPart: 'chest',
      loadMode: 'external',
      preset: true,
      ignoredPrivateField: 'legacy',
    };
    backup.exercises.push(downgradedPreset);
    const candidate = await parseBackupFile(fileOf(backup));

    await restoreWithCurrentPreview(candidate, 'merge');

    expect(await db.exercises.get('p-assisted-pullup')).toMatchObject({
      name: '辅助引体向上',
      bodyPart: 'back',
      loadMode: 'assistance',
      preset: true,
    });
  });

  test('导出后恢复仍被历史引用的软删动作，不让它重新出现在动作库', async () => {
    const exercise = await addCustomExercise('历史自创划船', 'back');
    await addWorkoutItem('2026-07-16', exercise.id, [{ weight: 40, reps: 12 }]);
    await removeExercise(exercise.id);
    const backup = await buildJsonExport();
    await resetDb();
    await seedPresets();
    const candidate = await parseBackupFile(fileOf(backup));

    await restoreWithCurrentPreview(candidate, 'replace');

    expect(await db.exercises.get(exercise.id)).toMatchObject({
      name: '历史自创划船',
      deletedAt: expect.any(Number),
    });
    expect((await getDayItems('2026-07-16'))[0].exercise.name).toBe('历史自创划船');
  });

  test('完整覆盖只保留备份训练并恢复个人设置，但保留本机照片', async () => {
    await addWorkoutItem('2026-07-10', 'p-squat', [{ weight: 100, reps: 5 }]);
    await setWeight('2026-07-10', 74);
    await savePhoto('2026-07-10', new Blob(['proof'], { type: 'image/jpeg' }));
    const candidate = await parseBackupFile(fileOf(twoDayBackup()));

    await restoreWithCurrentPreview(candidate, 'replace');

    expect(await listAllWorkoutDates()).toEqual(['2026-07-18', '2026-07-19']);
    expect(await db.weightLogs.toArray()).toMatchObject([
      { id: 'weight-1', date: '2026-07-18', weightKg: 72.5, deletedAt: null },
    ]);
    expect(await getProfile()).toMatchObject({ weeklyGoal: 4, nickname: '铁人', onboarded: true });
    expect(await db.exercises.get('p-assisted-pullup')).toMatchObject({
      loadMode: 'assistance',
      preset: true,
    });
    expect(await db.photos.count()).toBe(1);
  });

  test('完整覆盖缺少个人设置的旧备份时，有训练记录就不会重新进入引导', async () => {
    const backup = legacyBackup();
    backup.profile = [];
    const candidate = await parseBackupFile(fileOf(backup));

    await restoreWithCurrentPreview(candidate, 'replace');

    expect(await getProfile()).toMatchObject({ onboarded: true, weeklyGoal: 4 });
  });

  test('合并旧备份缺少可选个人字段时保留当前值', async () => {
    await saveProfile({ weeklyGoal: 3, nickname: '当前昵称', onboarded: true });
    const backup = legacyBackup();
    backup.profile = [{ id: 'me', weeklyGoal: 5, nickname: '', onboarded: true }];
    const rawProfile = backup.profile[0] as Record<string, unknown>;
    delete rawProfile.nickname;
    const candidate = await parseBackupFile(fileOf(backup));

    await restoreWithCurrentPreview(candidate, 'merge');

    expect(await getProfile()).toMatchObject({ weeklyGoal: 5, nickname: '当前昵称' });
  });

  test('事务中途失败会回滚全部可恢复表', async () => {
    await addWorkoutItem('2026-07-10', 'p-squat', [{ weight: 100, reps: 5 }]);
    await setWeight('2026-07-10', 74);
    const before = await tableSnapshot();
    const candidate = await parseBackupFile(fileOf(twoDayBackup()));
    vi.spyOn(db.workoutItems, 'bulkPut').mockRejectedValueOnce(new Error('boom'));

    await expect(restoreWithCurrentPreview(candidate, 'replace')).rejects.toMatchObject({
      code: 'restore-failed',
    });

    expect(await tableSnapshot()).toEqual(before);
  });

  test('预览分别报告将删除的餐食缩略图和未保存候选', async () => {
    const candidate = await parseBackupFile(fileOf(v3Backup()));
    await db.mealPhotos.add(mealPhotoRow(new Blob(['private']), 'different-hash'));
    await db.mealEstimates.add(mealEstimateRow());

    const preview = await previewRestore(candidate, 'merge');

    expect(preview.mealPhotosToDelete).toBe(1);
    expect(preview.mealEstimatesToDiscard).toBe(1);
    expect(preview.fingerprint).toEqual(expect.any(String));
  });

  test('预览后照片状态变化会拒绝恢复且不改数据库', async () => {
    const candidate = await parseBackupFile(fileOf(v3Backup()));
    const preview = await previewRestore(candidate, 'merge');
    await db.mealPhotos.add(mealPhotoRow(new Blob(['new-private']), 'new-hash'));
    const before = await tableSnapshot();

    await expect(restoreBackup(candidate, 'merge', {
      previewFingerprint: preview.fingerprint,
      allowPhotoDeletion: true,
      allowEstimateDiscard: true,
    })).rejects.toMatchObject({ code: 'restore-preview-stale' });
    expect(await tableSnapshot()).toEqual(before);
  });

  test.each([
    ['训练', async () => {
      await db.workouts.add({
        id: 'workout:after-replace-preview',
        date: '2026-08-13',
        updatedAt: 20,
        deletedAt: null,
      });
    }],
    ['营养', async () => {
      await db.foods.add({
        ...customFoodRow(),
        id: 'food:custom:after-replace-preview',
        name: '预览后新增食物',
        updatedAt: 20,
      });
    }],
  ] as const)('replace 预览后新增%s行会拒绝恢复且完整保留数据库', async (_label, mutate) => {
    const candidate = await parseBackupFile(fileOf(v3Backup()));
    const preview = await previewRestore(candidate, 'replace');
    await mutate();
    const before = await tableSnapshot();

    await expect(restoreBackup(candidate, 'replace', {
      previewFingerprint: preview.fingerprint,
      allowPhotoDeletion: true,
      allowEstimateDiscard: true,
    })).rejects.toMatchObject({ code: 'restore-preview-stale' });
    expect(await tableSnapshot()).toEqual(before);
  });

  test.each([
    ['同餐 mealItem', async (candidate: RestoreCandidate) => {
      await db.mealItems.add({
        ...mealItemRow(),
        id: 'meal-item:after-merge-preview',
        mealId: candidate.data.meals[0].id,
        order: 99,
        updatedAt: 21,
      });
    }],
    ['同日训练', async (candidate: RestoreCandidate) => {
      await db.workouts.add({
        id: 'workout:after-merge-preview',
        date: candidate.data.workouts[0].date,
        updatedAt: 21,
        deletedAt: null,
      });
    }],
  ] as const)('merge 预览后新增%s会 stale 且完整保留数据库', async (_label, mutate) => {
    const candidate = await parseBackupFile(fileOf(v3Backup()));
    const preview = await previewRestore(candidate, 'merge');
    await mutate(candidate);
    const before = await tableSnapshot();

    await expect(restoreBackup(candidate, 'merge', {
      previewFingerprint: preview.fingerprint,
      allowPhotoDeletion: true,
      allowEstimateDiscard: true,
    })).rejects.toMatchObject({ code: 'restore-preview-stale' });
    expect(await tableSnapshot()).toEqual(before);
  });

  test('同一 meal ID 改变份量后旧批准指纹失效且不改数据库', async () => {
    const original = await parseBackupFile(fileOf(v3Backup()));
    const approved = await previewRestore(original, 'merge');
    const changedBackup = v3Backup();
    changedBackup.mealItems[0].amount += 25;
    const changedCandidate = await parseBackupFile(fileOf(changedBackup));
    const before = await tableSnapshot();

    await expect(restoreBackup(changedCandidate, 'merge', {
      previewFingerprint: approved.fingerprint,
      allowPhotoDeletion: true,
      allowEstimateDiscard: true,
    })).rejects.toMatchObject({ code: 'restore-preview-stale' });
    expect(await tableSnapshot()).toEqual(before);
  });

  test('未独立确认时不得删除缩略图或候选', async () => {
    const candidate = await parseBackupFile(fileOf(v3Backup()));
    await db.mealPhotos.add(mealPhotoRow(new Blob(['private']), 'different-hash'));
    const preview = await previewRestore(candidate, 'merge');

    await expect(restoreBackup(candidate, 'merge', {
      previewFingerprint: preview.fingerprint,
      allowPhotoDeletion: false,
      allowEstimateDiscard: true,
    })).rejects.toMatchObject({ code: 'photo-confirmation-required' });
    expect(await db.mealPhotos.count()).toBe(1);
  });

  test.each(['custom-food', 'nutrition-plan'] as const)(
    '%s 业务身份碰撞在首次写入前拒绝并完整保留数据库',
    async (collision) => {
      const candidate = await parseBackupFile(fileOf(v3Backup()));
      if (collision === 'custom-food') {
        await db.foods.add({ ...customFoodRow(), name: '本机另一种食物' });
      } else {
        await db.nutritionPlans.add({
          ...nutritionPlanRow(),
          goals: { muscleGain: false, fatLoss: true },
        });
      }
      const preview = await previewRestore(candidate, 'merge');
      const before = await tableSnapshot();

      await expect(restoreBackup(candidate, 'merge', {
        previewFingerprint: preview.fingerprint,
        allowPhotoDeletion: true,
        allowEstimateDiscard: true,
      })).rejects.toMatchObject({ code: 'invalid-content' });
      expect(await tableSnapshot()).toEqual(before);
    },
  );

  test('非空 v3 营养备份重复 merge 幂等，第二次预览的删除计数归零', async () => {
    const candidate = await parseBackupFile(fileOf(v3Backup()));
    await db.mealPhotos.add(mealPhotoRow(new Blob(['private']), 'conflicting-hash'));
    await db.mealEstimates.add(mealEstimateRow());

    const firstPreview = await previewRestore(candidate, 'merge');
    expect(firstPreview.mealPhotosToDelete).toBe(1);
    expect(firstPreview.mealEstimatesToDiscard).toBe(1);
    await restoreBackup(candidate, 'merge', {
      previewFingerprint: firstPreview.fingerprint,
      allowPhotoDeletion: true,
      allowEstimateDiscard: true,
    });

    const secondPreview = await previewRestore(candidate, 'merge');
    expect(secondPreview.mealPhotosToDelete).toBe(0);
    expect(secondPreview.mealEstimatesToDiscard).toBe(0);
    await restoreBackup(candidate, 'merge', {
      previewFingerprint: secondPreview.fingerprint,
      allowPhotoDeletion: false,
      allowEstimateDiscard: false,
    });

    expect(await db.nutritionPlans.count()).toBe(1);
    expect((await db.foods.toArray()).filter((food) => !food.preset)).toHaveLength(1);
    expect(await db.meals.count()).toBe(1);
    expect(await db.mealItems.count()).toBe(1);
  });

  test.each(['merge', 'replace'] as const)('%s 中途失败回滚训练、营养、候选和照片', async (mode) => {
    const candidate = await parseBackupFile(fileOf(v3Backup()));
    await db.mealPhotos.add(mealPhotoRow(new Blob(['private']), 'different-hash'));
    await db.mealEstimates.add(mealEstimateRow());
    const preview = await previewRestore(candidate, mode);
    const before = await tableSnapshot();
    vi.spyOn(db.mealItems, 'bulkPut').mockRejectedValueOnce(new Error('boom'));

    await expect(restoreBackup(candidate, mode, {
      previewFingerprint: preview.fingerprint,
      allowPhotoDeletion: true,
      allowEstimateDiscard: true,
    })).rejects.toMatchObject({ code: 'restore-failed' });
    expect(await tableSnapshot()).toEqual(before);
  });

  test('未独立确认时不得丢弃未保存候选', async () => {
    const candidate = await parseBackupFile(fileOf(v3Backup()));
    await db.mealEstimates.add(mealEstimateRow());
    const preview = await previewRestore(candidate, 'merge');
    const before = await tableSnapshot();

    await expect(restoreBackup(candidate, 'merge', {
      previewFingerprint: preview.fingerprint,
      allowPhotoDeletion: true,
      allowEstimateDiscard: false,
    })).rejects.toMatchObject({ code: 'draft-confirmation-required' });
    expect(await tableSnapshot()).toEqual(before);
  });

  test('replace 精确清理营养临时态、保留预设和体型照并保留 point 计划计算基准', async () => {
    const activePoint = activePointNutritionPlanRow();
    const backup = v3Backup();
    backup.nutritionPlans = serializeNutritionSection({
      nutritionPlans: [activePoint],
      foods: [],
      meals: [],
      mealItems: [],
    }).nutritionPlans;
    const candidate = await parseBackupFile(fileOf(backup));
    const localMeal = {
      ...mealRow(),
      id: 'meal:2026-08-13:dinner',
      date: '2026-08-13',
      slot: 'dinner' as const,
    };
    await addWorkoutItem('2026-07-10', 'p-squat', [{ weight: 100, reps: 5 }]);
    await setWeight('2026-07-10', 74);
    await savePhoto('2026-07-10', new Blob(['body-proof'], { type: 'image/jpeg' }));
    await db.nutritionPlans.add({
      ...nutritionPlanRow(),
      id: 'nutrition-plan:2026-08-13',
      effectiveFrom: '2026-08-13',
    });
    await db.foods.bulkAdd([
      presetFoodRow(),
      { ...customFoodRow(), id: 'food:custom:local', name: '本机食物' },
    ]);
    await db.meals.add(localMeal);
    await db.mealItems.add({
      ...mealItemRow(),
      id: 'meal-item:local',
      mealId: localMeal.id,
    });
    await db.mealPhotos.add({
      ...mealPhotoRow(new Blob(['local-private'])),
      id: `meal-photo:${localMeal.id}`,
      mealId: localMeal.id,
    });
    await db.mealEstimates.add({
      ...mealEstimateRow(),
      id: `meal-estimate:${localMeal.id}`,
      mealId: localMeal.id,
    });

    const preview = await previewRestore(candidate, 'replace');
    expect(preview).toMatchObject({ mealPhotosToDelete: 1, mealEstimatesToDiscard: 1 });
    const result = await restoreBackup(candidate, 'replace', {
      previewFingerprint: preview.fingerprint,
      allowPhotoDeletion: true,
      allowEstimateDiscard: true,
    });
    const after = await tableSnapshot();

    expect(result).toEqual({ workoutDays: 1, nutritionDays: 1 });
    expect(after.workouts.map((row) => row.id)).toEqual(['w-1']);
    expect(after.workoutItems.map((row) => row.id)).toEqual(['wi-1']);
    expect(after.exercises.some((row) => row.id === 'custom-row')).toBe(true);
    expect(after.weightLogs.map((row) => row.id)).toEqual(['weight-1']);
    expect(after.photos).toHaveLength(1);
    expect(after.profile.map((row) => row.id)).toEqual(['me']);
    expect(after.nutritionPlans.map((row) => row.id)).toEqual([activePoint.id]);
    expect(after.nutritionPlans[0].equationInputs.calculatedAt)
      .toBe(activePoint.equationInputs.calculatedAt);
    expect(after.nutritionPlans[0].targetMode.energy).toBe('point');
    expect(after.foods.map((row) => row.id)).toEqual([
      customFoodRow().id,
      presetFoodRow().id,
    ]);
    expect(after.meals.map((row) => row.id)).toEqual([candidate.data.meals[0].id]);
    expect(after.mealItems.map((row) => row.id)).toEqual([candidate.data.mealItems[0].id]);
    expect(after.mealPhotos).toEqual([]);
    expect(after.mealEstimates).toEqual([]);
  });

  test('审批通过后的异步阶段原地修改 candidate 不会改变实际写入内容', async () => {
    const candidate = await parseBackupFile(fileOf(v3Backup()));
    const approvedWorkoutDate = candidate.data.workouts[0].date;
    const approvedMealAmount = candidate.data.mealItems[0].amount;
    const preview = await previewRestore(candidate, 'merge');
    const originalBulkGet = db.workouts.bulkGet.bind(db.workouts);
    vi.spyOn(db.workouts, 'bulkGet').mockImplementationOnce((keys) => {
      candidate.data.workouts[0].date = '2026-08-15';
      candidate.data.mealItems[0].amount = approvedMealAmount + 500;
      return originalBulkGet(keys);
    });

    await restoreBackup(candidate, 'merge', {
      previewFingerprint: preview.fingerprint,
      allowPhotoDeletion: true,
      allowEstimateDiscard: true,
    });

    expect(candidate.data.workouts[0].date).toBe('2026-08-15');
    expect((await db.workouts.get(candidate.data.workouts[0].id))?.date)
      .toBe(approvedWorkoutDate);
    expect((await db.mealItems.get(candidate.data.mealItems[0].id))?.amount)
      .toBe(approvedMealAmount);
  });

  test('恢复入口同步快照 approval，调用后改确认值不能绕过照片门禁', async () => {
    const candidate = await parseBackupFile(fileOf(v3Backup()));
    await db.mealPhotos.add(mealPhotoRow(new Blob(['private']), 'different-hash'));
    const preview = await previewRestore(candidate, 'merge');
    const approval = {
      previewFingerprint: preview.fingerprint,
      allowPhotoDeletion: false,
      allowEstimateDiscard: true,
    };

    const restoring = restoreBackup(candidate, 'merge', approval);
    approval.allowPhotoDeletion = true;

    await expect(restoring).rejects.toMatchObject({ code: 'photo-confirmation-required' });
    expect(await db.mealPhotos.count()).toBe(1);
  });

  const secondConnectionCases = [
    {
      label: '新增 workout',
      seed: async () => undefined,
      mutate: async (second: NutritionDb) => second.workouts.add({
        id: 'workout:second-connection-new',
        date: '2026-08-13',
        updatedAt: 30,
        deletedAt: null,
      }),
    },
    {
      label: '改变 workout 内容',
      seed: async () => db.workouts.add({
        id: 'workout:second-connection-existing',
        date: '2026-08-12',
        note: '变更前',
        updatedAt: 30,
        deletedAt: null,
      }),
      mutate: async (second: NutritionDb) => second.workouts.put({
        id: 'workout:second-connection-existing',
        date: '2026-08-12',
        note: '变更后',
        updatedAt: 31,
        deletedAt: null,
      }),
    },
    {
      label: '新增 mealItem',
      seed: async () => undefined,
      mutate: async (second: NutritionDb) => second.mealItems.add({
        ...mealItemRow(),
        id: 'meal-item:second-connection-new',
        order: 99,
        updatedAt: 31,
      }),
    },
    {
      label: '改变 nutritionPlan 内容',
      seed: async () => db.nutritionPlans.add(nutritionPlanRow()),
      mutate: async (second: NutritionDb) => second.nutritionPlans.put({
        ...nutritionPlanRow(),
        goals: { muscleGain: false, fatLoss: true },
        updatedAt: 31,
      }),
    },
  ] as const;

  test.each(
    (['merge', 'replace'] as const).flatMap((mode) =>
      secondConnectionCases.map(({ label, seed, mutate }) => [mode, label, seed, mutate] as const)),
  )('%s 预览后第二 Dexie 连接%s会 stale 且逐表不变', async (mode, _label, seed, mutate) => {
    await seed();
    const candidate = await parseBackupFile(fileOf(v3Backup()));
    const preview = await previewRestore(candidate, mode);
    await withSecondConnection(mutate);
    const before = await tableSnapshot();

    await expect(restoreBackup(candidate, mode, {
      previewFingerprint: preview.fingerprint,
      allowPhotoDeletion: true,
      allowEstimateDiscard: true,
    })).rejects.toMatchObject({ code: 'restore-preview-stale' });
    expect(await tableSnapshot()).toEqual(before);
  }, 2_000);
});
