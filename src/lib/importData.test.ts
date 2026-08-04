import { describe, expect, test } from 'vitest';
import {
  MAX_BACKUP_BYTES,
  parseBackupFile,
} from './importData';

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
