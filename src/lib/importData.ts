import { PRESET_EXERCISES } from '../data/presetExercises';
import { parseDate, toDateStr } from './dates';
import { BACKUP_SCHEMA_VERSION } from './exportData';
import type {
  BodyPart,
  Exercise,
  LoadMode,
  Profile,
  SetEntry,
  WeightLog,
  Workout,
  WorkoutItem,
} from './types';
import { LIMITS, validBodyWeight, validLoad, validReps } from './validation';

export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

export type RestoreMode = 'merge' | 'replace';
export type BackupErrorCode =
  | 'file-too-large'
  | 'invalid-json'
  | 'future-version'
  | 'invalid-content'
  | 'restore-failed';

export class BackupImportError extends Error {
  constructor(
    public readonly code: BackupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BackupImportError';
  }
}

export interface BackupPreview {
  exportedAt: string;
  workoutDays: number;
  exercises: number;
  sets: number;
  weightLogs: number;
}

type BackupWorkout = Pick<Workout, 'id' | 'date' | 'note'>;
type BackupWorkoutItem = Pick<WorkoutItem, 'id' | 'workoutId' | 'exerciseId' | 'order' | 'sets'>;
type BackupExercise = Required<Pick<Exercise, 'id' | 'name' | 'bodyPart' | 'loadMode' | 'preset'>>;
type BackupWeightLog = Pick<WeightLog, 'id' | 'date' | 'weightKg'>;
type BackupProfile = Pick<Profile, 'id' | 'weeklyGoal' | 'nickname' | 'onboarded'>;

export interface RestoreCandidate {
  schemaVersion: 0 | 1;
  preview: BackupPreview;
  data: {
    workouts: BackupWorkout[];
    workoutItems: BackupWorkoutItem[];
    exercises: BackupExercise[];
    weightLogs: BackupWeightLog[];
    profile: BackupProfile[];
  };
}

const BODY_PARTS = new Set<BodyPart>([
  'chest',
  'shoulder',
  'back',
  'leg',
  'arm',
  'core',
  'cardio',
]);
const LOAD_MODES = new Set<LoadMode>(['external', 'assistance']);
const PRESET_IDS = new Set(PRESET_EXERCISES.map((exercise) => exercise.id));

function invalid(message: string): never {
  throw new BackupImportError('invalid-content', message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(`${label}格式不正确`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${label}必须是数组`);
  return value;
}

function stringValue(
  value: unknown,
  label: string,
  options: { empty?: boolean; max?: number } = {},
): string {
  if (typeof value !== 'string') invalid(`${label}必须是文字`);
  if (!options.empty && value.trim().length === 0) invalid(`${label}不能为空`);
  if (value.length > (options.max ?? 200)) invalid(`${label}过长`);
  return value;
}

function idValue(value: unknown, label: string): string {
  return stringValue(value, label, { max: 200 });
}

function dateValue(value: unknown, label: string): string {
  const date = stringValue(value, label, { max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || toDateStr(parseDate(date)) !== date) {
    invalid(`${label}不是有效日期`);
  }
  return date;
}

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) invalid(`${label}存在重复值`);
}

function parseSets(value: unknown, label: string): SetEntry[] {
  const rows = array(value, label);
  if (rows.length < LIMITS.sets.min || rows.length > LIMITS.sets.max) {
    invalid(`${label}组数超出范围`);
  }
  return rows.map((raw, index) => {
    const source = record(raw, `${label}第 ${index + 1} 组`);
    const set: SetEntry = {};
    if (source.weight !== undefined) {
      if (typeof source.weight !== 'number' || !validLoad(source.weight)) {
        invalid(`${label}第 ${index + 1} 组重量超出范围`);
      }
      set.weight = source.weight;
    }
    if (source.reps !== undefined) {
      if (typeof source.reps !== 'number' || !validReps(source.reps)) {
        invalid(`${label}第 ${index + 1} 组次数超出范围`);
      }
      set.reps = source.reps;
    }
    return set;
  });
}

function schemaVersionOf(source: Record<string, unknown>): 0 | 1 {
  if (source.schemaVersion === undefined) return 0;
  if (!Number.isInteger(source.schemaVersion) || typeof source.schemaVersion !== 'number') {
    invalid('备份版本格式不正确');
  }
  if (source.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new BackupImportError('future-version', '备份来自更新版本，请先更新铁证');
  }
  if (source.schemaVersion !== 0 && source.schemaVersion !== 1) invalid('备份版本不受支持');
  return source.schemaVersion;
}

function parseBackupValue(value: unknown): RestoreCandidate {
  const source = record(value, '备份文件');
  const schemaVersion = schemaVersionOf(source);
  const exportedAt = stringValue(source.exportedAt, '备份时间', { max: 50 });
  if (!Number.isFinite(Date.parse(exportedAt))) invalid('备份时间不正确');

  const workouts = array(source.workouts, '训练记录').map((raw, index): BackupWorkout => {
    const row = record(raw, `第 ${index + 1} 条训练记录`);
    const note = row.note === undefined ? '' : stringValue(row.note, '训练备注', { empty: true, max: 10_000 });
    return {
      id: idValue(row.id, '训练 ID'),
      date: dateValue(row.date, '训练日期'),
      note,
    };
  });

  const workoutItems = array(source.workoutItems, '训练动作').map(
    (raw, index): BackupWorkoutItem => {
      const row = record(raw, `第 ${index + 1} 条训练动作`);
      if (typeof row.order !== 'number' || !Number.isInteger(row.order) || row.order < 0) {
        invalid('训练动作顺序不正确');
      }
      return {
        id: idValue(row.id, '训练动作 ID'),
        workoutId: idValue(row.workoutId, '训练 ID'),
        exerciseId: idValue(row.exerciseId, '动作 ID'),
        order: row.order,
        sets: parseSets(row.sets, '训练组'),
      };
    },
  );

  const exercises = array(source.exercises, '动作库').map((raw, index): BackupExercise => {
    const row = record(raw, `第 ${index + 1} 个动作`);
    const id = idValue(row.id, '动作 ID');
    if (typeof row.bodyPart !== 'string' || !BODY_PARTS.has(row.bodyPart as BodyPart)) {
      invalid('动作部位不正确');
    }
    const loadMode = row.loadMode === undefined ? 'external' : row.loadMode;
    if (typeof loadMode !== 'string' || !LOAD_MODES.has(loadMode as LoadMode)) {
      invalid('动作重量类型不正确');
    }
    if (typeof row.preset !== 'boolean') invalid('动作预设标记不正确');
    if (row.preset && !PRESET_IDS.has(id)) invalid('备份包含未知的系统预设动作');
    return {
      id,
      name: stringValue(row.name, '动作名称', { max: 100 }),
      bodyPart: row.bodyPart as BodyPart,
      loadMode: loadMode as LoadMode,
      preset: row.preset,
    };
  });

  const weightLogs = array(source.weightLogs, '体重记录').map((raw): BackupWeightLog => {
    const row = record(raw, '体重记录');
    if (typeof row.weightKg !== 'number' || !validBodyWeight(row.weightKg)) {
      invalid('体重数值超出范围');
    }
    return {
      id: idValue(row.id, '体重记录 ID'),
      date: dateValue(row.date, '体重日期'),
      weightKg: row.weightKg,
    };
  });

  const profileRows = array(source.profile, '个人设置');
  if (profileRows.length > 1) invalid('个人设置存在重复记录');
  const profile = profileRows.map((raw): BackupProfile => {
    const row = record(raw, '个人设置');
    if (row.id !== 'me') invalid('个人设置 ID 不正确');
    if (
      typeof row.weeklyGoal !== 'number' ||
      !Number.isInteger(row.weeklyGoal) ||
      row.weeklyGoal < 1 ||
      row.weeklyGoal > 7
    ) {
      invalid('每周目标超出范围');
    }
    if (typeof row.onboarded !== 'boolean') invalid('引导状态不正确');
    return {
      id: 'me',
      weeklyGoal: row.weeklyGoal,
      nickname:
        row.nickname === undefined
          ? ''
          : stringValue(row.nickname, '昵称', { empty: true, max: 50 }),
      onboarded: row.onboarded,
    };
  });

  unique(workouts.map((row) => row.id), '训练 ID');
  unique(workouts.map((row) => row.date), '训练日期');
  unique(workoutItems.map((row) => row.id), '训练动作 ID');
  unique(exercises.map((row) => row.id), '动作 ID');
  unique(weightLogs.map((row) => row.id), '体重记录 ID');
  unique(weightLogs.map((row) => row.date), '体重日期');

  const workoutIds = new Set(workouts.map((row) => row.id));
  const exerciseIds = new Set([...exercises.map((row) => row.id), ...PRESET_IDS]);
  const workoutIdsWithItems = new Set<string>();
  for (const item of workoutItems) {
    if (!workoutIds.has(item.workoutId)) invalid('训练动作引用了不存在的训练');
    if (!exerciseIds.has(item.exerciseId)) invalid('训练动作引用了不存在的动作');
    workoutIdsWithItems.add(item.workoutId);
  }
  if (workouts.some((workout) => !workoutIdsWithItems.has(workout.id))) {
    invalid('训练记录缺少动作明细');
  }

  return {
    schemaVersion,
    preview: {
      exportedAt,
      workoutDays: workouts.length,
      exercises: exercises.length,
      sets: workoutItems.reduce((sum, item) => sum + item.sets.length, 0),
      weightLogs: weightLogs.length,
    },
    data: { workouts, workoutItems, exercises, weightLogs, profile },
  };
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}

export async function parseBackupFile(file: File): Promise<RestoreCandidate> {
  if (file.size > MAX_BACKUP_BYTES) {
    throw new BackupImportError('file-too-large', '备份文件不能超过 10 MB');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readFileText(file));
  } catch {
    throw new BackupImportError('invalid-json', '文件不是有效的 JSON 备份');
  }

  return parseBackupValue(raw);
}
