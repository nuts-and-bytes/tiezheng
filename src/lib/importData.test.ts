import { beforeEach, describe, expect, test, vi } from 'vitest';
import { db } from './db';
import {
  MAX_BACKUP_BYTES,
  parseBackupFile,
  restoreBackup,
} from './importData';
import { seedPresets } from '../repos/exerciseRepo';
import { savePhoto } from '../repos/photoRepo';
import { getProfile, saveProfile } from '../repos/profileRepo';
import { addWorkoutItem, getDayItems, listAllWorkoutDates } from '../repos/workoutRepo';
import { setWeight } from '../repos/weightRepo';
import { resetDb } from '../test/dbTestUtils';

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
    });
    expect(candidate.preview).toEqual({
      exportedAt: backup.exportedAt,
      workoutDays: 1,
      exercises: 1,
      sets: 2,
      weightLogs: 1,
    });
  });

  test('保留当前备份中的辅助重量类型', async () => {
    const backup = legacyBackup();
    const current = {
      ...backup,
      schemaVersion: 1,
      exercises: [{ ...backup.exercises[0], loadMode: 'assistance' }],
    };

    const candidate = await parseBackupFile(fileOf(current));

    expect(candidate.schemaVersion).toBe(1);
    expect(candidate.data.exercises[0].loadMode).toBe('assistance');
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

async function tableSnapshot() {
  return {
    workouts: await db.workouts.toArray(),
    workoutItems: await db.workoutItems.toArray(),
    exercises: await db.exercises.toArray(),
    weightLogs: await db.weightLogs.toArray(),
    profile: await db.profile.toArray(),
  };
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

    const result = await restoreBackup(candidate, 'merge');

    expect(result).toEqual({ workoutDays: 2 });
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

    await restoreBackup(candidate, 'merge');
    await restoreBackup(candidate, 'merge');

    expect(await db.workouts.count()).toBe(2);
    expect(await db.workoutItems.count()).toBe(2);
    expect(await db.weightLogs.count()).toBe(1);
    expect(await db.exercises.where('id').equals('custom-row').count()).toBe(1);
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

    await restoreBackup(candidate, 'merge');

    expect(await db.exercises.get('p-assisted-pullup')).toMatchObject({
      name: '辅助引体向上',
      bodyPart: 'back',
      loadMode: 'assistance',
      preset: true,
    });
  });

  test('完整覆盖只保留备份训练并恢复个人设置，但保留本机照片', async () => {
    await addWorkoutItem('2026-07-10', 'p-squat', [{ weight: 100, reps: 5 }]);
    await setWeight('2026-07-10', 74);
    await savePhoto('2026-07-10', new Blob(['proof'], { type: 'image/jpeg' }));
    const candidate = await parseBackupFile(fileOf(twoDayBackup()));

    await restoreBackup(candidate, 'replace');

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

  test('合并旧备份缺少可选个人字段时保留当前值', async () => {
    await saveProfile({ weeklyGoal: 3, nickname: '当前昵称', onboarded: true });
    const backup = legacyBackup();
    backup.profile = [{ id: 'me', weeklyGoal: 5, nickname: '', onboarded: true }];
    const rawProfile = backup.profile[0] as Record<string, unknown>;
    delete rawProfile.nickname;
    const candidate = await parseBackupFile(fileOf(backup));

    await restoreBackup(candidate, 'merge');

    expect(await getProfile()).toMatchObject({ weeklyGoal: 5, nickname: '当前昵称' });
  });

  test('事务中途失败会回滚全部可恢复表', async () => {
    await addWorkoutItem('2026-07-10', 'p-squat', [{ weight: 100, reps: 5 }]);
    await setWeight('2026-07-10', 74);
    const before = await tableSnapshot();
    const candidate = await parseBackupFile(fileOf(twoDayBackup()));
    vi.spyOn(db.workoutItems, 'bulkPut').mockRejectedValueOnce(new Error('boom'));

    await expect(restoreBackup(candidate, 'replace')).rejects.toMatchObject({
      code: 'restore-failed',
    });

    expect(await tableSnapshot()).toEqual(before);
  });
});
