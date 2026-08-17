import Dexie from 'dexie';
import { PRESET_EXERCISES } from '../data/presetExercises';
import { parseDate, toDateStr } from './dates';
import { db, DEFAULT_PROFILE } from './db';
import { BACKUP_SCHEMA_VERSION } from './exportData';
import {
  parseNutritionSection,
  type NutritionBackupSection,
} from './nutritionBackup';
import {
  applyNutritionRestore,
  assertNutritionMergeIdSafety,
  buildIncomingMealHashes,
  calculateNutritionRestorePlan,
  type NutritionRestorePlan,
} from './nutritionRestore';
import { stableJson } from './stableJson';
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
  | 'restore-preview-stale'
  | 'photo-confirmation-required'
  | 'draft-confirmation-required'
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
  nutritionPlans: number;
  nutritionDays: number;
  meals: number;
  mealItems: number;
}

type BackupWorkout = Pick<Workout, 'id' | 'date' | 'note'>;
type BackupWorkoutItem = Pick<WorkoutItem, 'id' | 'workoutId' | 'exerciseId' | 'order' | 'sets'>;
type BackupExercise = Required<Pick<Exercise, 'id' | 'name' | 'bodyPart' | 'loadMode' | 'preset'>> & {
  archived: boolean;
};
type BackupWeightLog = Pick<WeightLog, 'id' | 'date' | 'weightKg'>;
type BackupProfile = Pick<Profile, 'id' | 'weeklyGoal' | 'nickname' | 'onboarded'>;

export interface RestoreCandidate {
  schemaVersion: 0 | 1 | 2 | 3;
  preview: BackupPreview;
  data: {
    workouts: BackupWorkout[];
    workoutItems: BackupWorkoutItem[];
    exercises: BackupExercise[];
    weightLogs: BackupWeightLog[];
    profile: BackupProfile[];
  } & NutritionBackupSection;
}

export interface ModeRestorePreview extends BackupPreview {
  fingerprint: string;
  mealPhotosToDelete: number;
  mealEstimatesToDiscard: number;
}

export interface RestoreApproval {
  previewFingerprint: string;
  allowPhotoDeletion: boolean;
  allowEstimateDiscard: boolean;
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

function activeLegacyRows(value: unknown, label: string): unknown[] {
  return array(value, label).filter((raw, index) => {
    const row = record(raw, `${label}第 ${index + 1} 行`);
    return row.deletedAt === undefined || row.deletedAt === null;
  });
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

function schemaVersionOf(source: Record<string, unknown>): 0 | 1 | 2 | 3 {
  if (source.schemaVersion === undefined) return 0;
  if (!Number.isInteger(source.schemaVersion) || typeof source.schemaVersion !== 'number') {
    invalid('备份版本格式不正确');
  }
  if (source.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new BackupImportError('future-version', '备份来自更新版本，请先更新铁证');
  }
  if (
    source.schemaVersion !== 0 &&
    source.schemaVersion !== 1 &&
    source.schemaVersion !== 2 &&
    source.schemaVersion !== 3
  ) {
    invalid('备份版本不受支持');
  }
  return source.schemaVersion;
}

function parseBackupValue(value: unknown): RestoreCandidate {
  const source = record(value, '备份文件');
  const schemaVersion = schemaVersionOf(source);
  const exportedAt = stringValue(source.exportedAt, '备份时间', { max: 50 });
  if (!Number.isFinite(Date.parse(exportedAt))) invalid('备份时间不正确');

  const workouts = activeLegacyRows(source.workouts, '训练记录').map((raw, index): BackupWorkout => {
    const row = record(raw, `第 ${index + 1} 条训练记录`);
    const note = row.note === undefined ? '' : stringValue(row.note, '训练备注', { empty: true, max: 10_000 });
    return {
      id: idValue(row.id, '训练 ID'),
      date: dateValue(row.date, '训练日期'),
      note,
    };
  });

  const workoutItems = activeLegacyRows(source.workoutItems, '训练动作').map(
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

  const referencedExerciseIds = new Set(workoutItems.map((item) => item.exerciseId));
  const exerciseRows = array(source.exercises, '动作库').filter((raw, index) => {
    const row = record(raw, `动作库第 ${index + 1} 行`);
    return (
      row.deletedAt === undefined ||
      row.deletedAt === null ||
      (typeof row.id === 'string' && referencedExerciseIds.has(row.id))
    );
  });
  const exercises = exerciseRows.map((raw, index): BackupExercise => {
    const row = record(raw, `第 ${index + 1} 个动作`);
    const id = idValue(row.id, '动作 ID');
    if (typeof row.bodyPart !== 'string' || !BODY_PARTS.has(row.bodyPart as BodyPart)) {
      invalid('动作部位不正确');
    }
    if (schemaVersion >= 1 && row.loadMode === undefined) {
      invalid('新版备份的动作缺少重量类型');
    }
    const loadMode = row.loadMode === undefined ? 'external' : row.loadMode;
    if (typeof loadMode !== 'string' || !LOAD_MODES.has(loadMode as LoadMode)) {
      invalid('动作重量类型不正确');
    }
    if (typeof row.preset !== 'boolean') invalid('动作预设标记不正确');
    if (row.preset && !PRESET_IDS.has(id)) invalid('备份包含未知的系统预设动作');
    const archived =
      schemaVersion === 0
        ? row.deletedAt !== undefined && row.deletedAt !== null
        : schemaVersion === 1 && row.archived === undefined
          ? false
          : row.archived;
    if (typeof archived !== 'boolean') invalid('v2 备份的动作缺少归档状态');
    return {
      id,
      name: stringValue(row.name, '动作名称', { max: 100 }),
      bodyPart: row.bodyPart as BodyPart,
      loadMode: loadMode as LoadMode,
      preset: row.preset,
      archived,
    };
  });

  const weightLogs = activeLegacyRows(source.weightLogs, '体重记录').map((raw): BackupWeightLog => {
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
    const onboarded = row.onboarded === undefined ? workouts.length > 0 : row.onboarded;
    if (typeof onboarded !== 'boolean') invalid('引导状态不正确');
    const result: BackupProfile = {
      id: 'me',
      weeklyGoal: row.weeklyGoal,
      onboarded,
    };
    if (row.nickname !== undefined) {
      result.nickname = stringValue(row.nickname, '昵称', { empty: true, max: 50 });
    }
    return result;
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

  const parsedNutrition = parseNutritionSection(source, schemaVersion, invalid);
  const nutrition: NutritionBackupSection = {
    nutritionPlans: [...parsedNutrition.nutritionPlans],
    foods: [...parsedNutrition.foods],
    meals: [...parsedNutrition.meals],
    mealItems: [...parsedNutrition.mealItems],
  };
  const nutritionDays = new Set(nutrition.meals.map((meal) => meal.date)).size;

  return {
    schemaVersion,
    preview: {
      exportedAt,
      workoutDays: workouts.length,
      exercises: exercises.length,
      sets: workoutItems.reduce((sum, item) => sum + item.sets.length, 0),
      weightLogs: weightLogs.length,
      nutritionPlans: nutrition.nutritionPlans.length,
      nutritionDays,
      meals: nutrition.meals.length,
      mealItems: nutrition.mealItems.length,
    },
    data: { workouts, workoutItems, exercises, weightLogs, profile, ...nutrition },
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

function currentPresetRows(now: number): Exercise[] {
  return PRESET_EXERCISES.map((exercise) => ({
    ...exercise,
    preset: true,
    updatedAt: now,
    deletedAt: null,
  }));
}

async function deleteWorkoutsMatching(candidate: RestoreCandidate): Promise<void> {
  const dates = candidate.data.workouts.map((workout) => workout.date);
  const dateMatches =
    dates.length > 0 ? await db.workouts.where('date').anyOf(dates).toArray() : [];
  const ids = [...new Set(dateMatches.map((workout) => workout.id))];
  if (ids.length === 0) return;
  await db.workoutItems.where('workoutId').anyOf(ids).delete();
  await db.workouts.bulkDelete(ids);
}

async function deleteWeightsMatching(candidate: RestoreCandidate): Promise<void> {
  const dates = candidate.data.weightLogs.map((weight) => weight.date);
  if (dates.length > 0) await db.weightLogs.where('date').anyOf(dates).delete();
}

async function assertMergeIdSafety(candidate: RestoreCandidate): Promise<void> {
  const workoutDates = new Set(candidate.data.workouts.map((workout) => workout.date));
  const currentWorkouts = await db.workouts.bulkGet(
    candidate.data.workouts.map((workout) => workout.id),
  );
  if (
    currentWorkouts.some(
      (workout) => workout && workout.deletedAt === null && !workoutDates.has(workout.date),
    )
  ) {
    invalid('备份训练 ID 与本机其他日期冲突');
  }

  const dateMatches =
    workoutDates.size > 0
      ? await db.workouts.where('date').anyOf([...workoutDates]).toArray()
      : [];
  const replaceableWorkoutIds = new Set(dateMatches.map((workout) => workout.id));
  const currentItems = await db.workoutItems.bulkGet(
    candidate.data.workoutItems.map((item) => item.id),
  );
  if (
    currentItems.some(
      (item) =>
        item && item.deletedAt === null && !replaceableWorkoutIds.has(item.workoutId),
    )
  ) {
    invalid('备份训练动作 ID 与本机其他日期冲突');
  }

  const weightDates = new Set(candidate.data.weightLogs.map((weight) => weight.date));
  const currentWeights = await db.weightLogs.bulkGet(
    candidate.data.weightLogs.map((weight) => weight.id),
  );
  if (
    currentWeights.some(
      (weight) => weight && weight.deletedAt === null && !weightDates.has(weight.date),
    )
  ) {
    invalid('备份体重 ID 与本机其他日期冲突');
  }
}

async function clearRestorableTables(): Promise<void> {
  await db.workoutItems.clear();
  await db.workouts.clear();
  await db.exercises.clear();
  await db.weightLogs.clear();
  await db.profile.clear();
}

async function applyCandidate(candidate: RestoreCandidate, mode: RestoreMode): Promise<void> {
  const now = Date.now();
  await db.exercises.bulkPut(currentPresetRows(now));

  const customExercises: Exercise[] = candidate.data.exercises
    .filter((exercise) => !PRESET_IDS.has(exercise.id))
    .map(({ archived, ...exercise }) => ({
      ...exercise,
      preset: false,
      updatedAt: now,
      deletedAt: archived ? now : null,
    }));
  if (customExercises.length > 0) await db.exercises.bulkPut(customExercises);

  await deleteWorkoutsMatching(candidate);

  const workouts: Workout[] = candidate.data.workouts.map((workout) => ({
    ...workout,
    updatedAt: now,
    deletedAt: null,
  }));
  const workoutItems: WorkoutItem[] = candidate.data.workoutItems.map((item) => ({
    ...item,
    updatedAt: now,
    deletedAt: null,
  }));
  if (workouts.length > 0) await db.workouts.bulkPut(workouts);
  if (workoutItems.length > 0) await db.workoutItems.bulkPut(workoutItems);

  await deleteWeightsMatching(candidate);
  const weights: WeightLog[] = candidate.data.weightLogs.map((weight) => ({
    ...weight,
    updatedAt: now,
    deletedAt: null,
  }));
  if (weights.length > 0) await db.weightLogs.bulkPut(weights);

  const backupProfile = candidate.data.profile[0];
  if (mode === 'replace') {
    await db.profile.put({
      ...DEFAULT_PROFILE,
      ...backupProfile,
      onboarded: backupProfile?.onboarded ?? candidate.data.workouts.length > 0,
      id: 'me',
      updatedAt: now,
    });
  } else if (backupProfile) {
    const current = await db.profile.get('me');
    await db.profile.put({
      ...DEFAULT_PROFILE,
      ...current,
      ...backupProfile,
      id: 'me',
      updatedAt: now,
    });
  }
}

interface CalculatedRestoreApprovalPlan {
  fingerprint: string;
  nutritionPlan: NutritionRestorePlan;
}

const restoreTables = () => [
  db.workouts,
  db.workoutItems,
  db.exercises,
  db.weightLogs,
  db.profile,
  db.nutritionPlans,
  db.foods,
  db.meals,
  db.mealItems,
  db.mealPhotos,
  db.mealEstimates,
] as const;

function sortedById<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => left.id.localeCompare(right.id));
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(
    new Uint8Array(bytes),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function thumbnailFingerprint(thumbnail: Blob) {
  const sha256 = await Dexie.waitFor((async () => {
    const bytes = await thumbnail.arrayBuffer();
    return hex(await crypto.subtle.digest('SHA-256', bytes));
  })());
  return { type: thumbnail.type, size: thumbnail.size, sha256 };
}

async function snapshotRestoreLocalState() {
  const [
    workouts,
    workoutItems,
    exercises,
    weightLogs,
    profile,
    nutritionPlans,
    foods,
    meals,
    mealItems,
    mealPhotos,
    mealEstimates,
  ] = await Promise.all([
    db.workouts.toArray(),
    db.workoutItems.toArray(),
    db.exercises.toArray(),
    db.weightLogs.toArray(),
    db.profile.toArray(),
    db.nutritionPlans.toArray(),
    db.foods.toArray(),
    db.meals.toArray(),
    db.mealItems.toArray(),
    db.mealPhotos.toArray(),
    db.mealEstimates.toArray(),
  ]);
  const mealPhotoRows = await Promise.all(mealPhotos.map(async ({ thumbnail, ...row }) => ({
    ...row,
    thumbnail: await thumbnailFingerprint(thumbnail),
  })));
  return {
    workouts: sortedById(workouts),
    workoutItems: sortedById(workoutItems),
    exercises: sortedById(exercises),
    weightLogs: sortedById(weightLogs),
    profile: sortedById(profile),
    nutritionPlans: sortedById(nutritionPlans),
    foods: sortedById(foods),
    meals: sortedById(meals),
    mealItems: sortedById(mealItems),
    mealPhotos: sortedById(mealPhotoRows),
    mealEstimates: sortedById(mealEstimates),
  };
}

async function calculateRestoreApprovalPlan(
  candidate: RestoreCandidate,
  mode: RestoreMode,
  hashes: Map<string, string>,
): Promise<CalculatedRestoreApprovalPlan> {
  const nutritionPlan = await calculateNutritionRestorePlan(candidate.data, mode, hashes);
  const localState = await snapshotRestoreLocalState();
  return {
    fingerprint: stableJson({
      version: 'restore-preview-v2',
      mode,
      candidate: candidate.data,
      nutritionFingerprint: nutritionPlan.fingerprint,
      localState,
    }),
    nutritionPlan,
  };
}

export async function previewRestore(
  candidate: RestoreCandidate,
  mode: RestoreMode,
): Promise<ModeRestorePreview> {
  const candidateSnapshot = structuredClone(candidate);
  const hashes = await buildIncomingMealHashes(candidateSnapshot.data);
  return db.transaction('r', restoreTables(), async () => {
    const plan = await calculateRestoreApprovalPlan(candidateSnapshot, mode, hashes);
    return {
      ...candidateSnapshot.preview,
      fingerprint: plan.fingerprint,
      mealPhotosToDelete: plan.nutritionPlan.photoIdsToDelete.length,
      mealEstimatesToDiscard: plan.nutritionPlan.estimateIdsToDelete.length,
    };
  });
}

export async function restoreBackup(
  candidate: RestoreCandidate,
  mode: RestoreMode,
  approval: RestoreApproval,
): Promise<{ workoutDays: number; nutritionDays: number }> {
  const candidateSnapshot = structuredClone(candidate);
  const approvalSnapshot = { ...approval };
  const hashes = await buildIncomingMealHashes(candidateSnapshot.data);
  try {
    await db.transaction(
      'rw',
      [
        db.workouts,
        db.workoutItems,
        db.exercises,
        db.weightLogs,
        db.profile,
        db.nutritionPlans,
        db.foods,
        db.meals,
        db.mealItems,
        db.mealPhotos,
        db.mealEstimates,
      ],
      async () => {
        const restorePlan = await calculateRestoreApprovalPlan(candidateSnapshot, mode, hashes);
        const { nutritionPlan } = restorePlan;
        if (restorePlan.fingerprint !== approvalSnapshot.previewFingerprint) {
          throw new BackupImportError(
            'restore-preview-stale',
            '本机数据在预览后发生变化，请重新确认恢复影响',
          );
        }
        if (nutritionPlan.photoIdsToDelete.length > 0 && !approvalSnapshot.allowPhotoDeletion) {
          throw new BackupImportError(
            'photo-confirmation-required',
            '需要先确认删除冲突的本机餐食缩略图',
          );
        }
        if (
          nutritionPlan.estimateIdsToDelete.length > 0
          && !approvalSnapshot.allowEstimateDiscard
        ) {
          throw new BackupImportError(
            'draft-confirmation-required',
            '需要先确认丢弃未保存的食物识别候选',
          );
        }

        if (mode === 'merge') {
          await assertMergeIdSafety(candidateSnapshot);
        }
        await assertNutritionMergeIdSafety(candidateSnapshot.data, mode, invalid);
        if (mode === 'replace') await clearRestorableTables();
        await applyCandidate(candidateSnapshot, mode);
        await applyNutritionRestore(candidateSnapshot.data, mode, nutritionPlan, Date.now());
      },
    );
    return {
      workoutDays: candidateSnapshot.preview.workoutDays,
      nutritionDays: candidateSnapshot.preview.nutritionDays,
    };
  } catch (error) {
    if (error instanceof BackupImportError) throw error;
    throw new BackupImportError('restore-failed', '恢复失败，原数据未发生变化');
  }
}
