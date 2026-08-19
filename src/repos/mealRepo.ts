import Dexie from 'dexie';
import { db, type NutritionDb } from '../lib/db';
import {
  FOOD_SNAPSHOT_LIMITS,
  assertBoundedStringArray,
  assertBoundedText,
  assertFiniteRange,
  assertFoodSnapshot,
  assertNullableSafeTimestamp,
  assertNutrientSnapshot,
  assertSafeTimestamp,
} from '../lib/foodSnapshotValidation';
import {
  mealEstimateId,
  mealId as makeMealId,
  mealItemId,
  mealPhotoId,
  operationKey,
  parseMealId,
} from '../lib/nutritionIds';
import {
  buildPhotoMealItem,
  type ConfirmedPhotoCandidate,
} from '../lib/photoAiCandidate';
import { buildMealSnapshotHash } from '../lib/mealSnapshot';
import {
  scaleFood,
  summarizeNutritionDay,
  type NutritionDaySummary,
} from '../lib/nutritionStats';
import { stableJson } from '../lib/stableJson';
import type {
  Food,
  Meal,
  MealEstimate,
  MealEstimateErrorCode,
  MealEstimateStatus,
  MealItem,
  MealPhoto,
  MealSlot,
} from '../lib/nutritionTypes';

export const MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export interface SaveConfirmedFoodItemInput {
  operationId: string;
  date: string;
  slot: MealSlot;
  food: Food;
  amount: number;
}

export interface NutritionDay {
  date: string;
  meals: Array<{ slot: MealSlot; meal: Meal | undefined; items: MealItem[] }>;
  summary: NutritionDaySummary;
}

export interface ConfirmPhotoEstimateInput {
  operationId: string;
  date: string;
  slot: MealSlot;
  requestId: string;
  uploadBlobSha256: string;
  candidates: ConfirmedPhotoCandidate[];
  thumbnail: { blob: Blob; width: number; height: number };
}

export interface MealRepository {
  saveConfirmedFoodItem(input: SaveConfirmedFoodItemInput): Promise<MealItem>;
  updateMealItemAmount(id: string, amount: number): Promise<MealItem>;
  removeMealItem(id: string): Promise<void>;
  removeMeal(id: string): Promise<void>;
  listNutritionDay(date: string): Promise<NutritionDay>;
  putMealPhoto(photo: MealPhoto): Promise<void>;
  putMealEstimate(estimate: MealEstimate): Promise<void>;
  clearMealTemporaryState(mealId: string): Promise<void>;
  confirmPhotoEstimate(input: ConfirmPhotoEstimateInput): Promise<MealItem[]>;
  clearMealEstimate(mealId: string): Promise<void>;
}

const ESTIMATE_STATUSES = new Set<MealEstimateStatus>([
  'preprocessing',
  'awaiting-consent',
  'uploading',
  'estimating',
  'needs-confirmation',
  'confirmed',
  'failed',
]);

const ESTIMATE_ERRORS = new Set<MealEstimateErrorCode>([
  'unsupported-file',
  'image-too-large',
  'decode-failed',
  'offline',
  'auth-required',
  'auth-expired',
  'quota-exceeded',
  'rate-limited',
  'service-disabled',
  'budget-exceeded',
  'consent-expired',
  'provider-timeout',
  'provider-unavailable',
  'invalid-estimate',
  'uncertain-food',
]);

function requirePositive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be finite and positive`);
  }
}

function requireFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be finite and non-negative`);
  }
}

function requireSafeTimestamp(value: number, field: string): void {
  assertSafeTimestamp(value, field);
}

function operationTimestamp(...floors: Array<number | null | undefined>): number {
  const now = Date.now();
  requireSafeTimestamp(now, 'Date.now()');
  let result = now;
  for (const floor of floors) {
    if (floor === null || floor === undefined) continue;
    requireSafeTimestamp(floor, 'stored timestamp');
    result = Math.max(result, floor);
  }
  return result;
}

function checkedMealId(date: string, slot: MealSlot): string {
  if (!MEAL_SLOTS.includes(slot)) throw new Error('invalid meal slot');
  return makeMealId(date, slot);
}

function compareIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function itemSemantic(item: MealItem): string {
  const {
    confirmedAt: _confirmedAt,
    order: _order,
    updatedAt: _updatedAt,
    deletedAt: _deletedAt,
    ...semantic
  } = item;
  void _confirmedAt;
  void _order;
  void _updatedAt;
  void _deletedAt;
  return stableJson(semantic);
}

const ITEM_METHODS = new Set<MealItem['method']>([
  'preset',
  'manual',
  'label',
  'ai-confirmed',
]);
const ITEM_QUALITIES = new Set<MealItem['quality']>(['A', 'B']);

function assertMealItemSnapshot(item: MealItem): void {
  assertBoundedText(item.id, 'meal item id', FOOD_SNAPSHOT_LIMITS.id);
  assertBoundedText(item.mealId, 'meal item mealId', FOOD_SNAPSHOT_LIMITS.id);
  assertBoundedText(item.name, 'meal item name', FOOD_SNAPSHOT_LIMITS.label);
  assertBoundedText(
    item.preparation,
    'meal item preparation',
    FOOD_SNAPSHOT_LIMITS.label,
    true,
  );
  assertFiniteRange(item.amount, 'meal item amount', 0.01, 100_000);
  if (item.unit !== 'g' && item.unit !== 'mL') throw new Error('meal item unit is invalid');
  assertNutrientSnapshot(item, 'meal item');
  assertFiniteRange(item.energyKcalLow, 'meal item energyKcalLow', 0, 100_000);
  assertFiniteRange(item.energyKcalHigh, 'meal item energyKcalHigh', 0, 100_000);
  assertFiniteRange(item.proteinGLow, 'meal item proteinGLow', 0, 10_000);
  assertFiniteRange(item.proteinGHigh, 'meal item proteinGHigh', 0, 10_000);
  if (item.energyKcalLow > item.energyKcalHigh) {
    throw new Error('meal item energy range must be ascending');
  }
  if (item.proteinGLow > item.proteinGHigh) {
    throw new Error('meal item protein range must be ascending');
  }
  assertBoundedStringArray(item.assumptions, 'meal item assumptions');
  assertBoundedText(item.uncertaintyModelVersion, 'meal item uncertaintyModelVersion');
  assertBoundedText(item.source, 'meal item source');
  assertBoundedText(item.sourceVersion, 'meal item sourceVersion');
  assertBoundedText(item.license, 'meal item license');
  if (!ITEM_METHODS.has(item.method)) throw new Error('meal item method is invalid');
  if (!ITEM_QUALITIES.has(item.quality)) throw new Error('meal item quality is invalid');
  assertSafeTimestamp(item.confirmedAt, 'meal item confirmedAt');
  if (!Number.isInteger(item.order) || item.order < 0 || item.order > 10_000) {
    throw new Error('meal item order must be an integer between 0 and 10000');
  }
  assertSafeTimestamp(item.updatedAt, 'meal item updatedAt');
  assertNullableSafeTimestamp(item.deletedAt, 'meal item deletedAt');
  if (item.deletedAt !== null && item.deletedAt > item.updatedAt) {
    throw new Error('meal item deletedAt must not exceed updatedAt');
  }

  let amountInBasisUnit = item.amount;
  if (item.unit !== item.basisUnit) {
    if (item.densityGPerMl === null) {
      throw new Error('meal item point estimate requires density for unit conversion');
    }
    amountInBasisUnit =
      item.basisUnit === 'g'
        ? item.amount * item.densityGPerMl
        : item.amount / item.densityGPerMl;
  }
  const portionFactor = amountInBasisUnit / item.basisAmount;
  const pointEnergy = item.energyKcal * portionFactor;
  const pointProtein = item.proteinG * portionFactor;
  requireFiniteNonNegative(pointEnergy, 'meal item point estimate energy');
  requireFiniteNonNegative(pointProtein, 'meal item point estimate protein');
  if (
    pointEnergy < item.energyKcalLow - 1e-6 ||
    pointEnergy > item.energyKcalHigh + 1e-6 ||
    pointProtein < item.proteinGLow - 1e-6 ||
    pointProtein > item.proteinGHigh + 1e-6
  ) {
    throw new Error('meal item point estimate must fall within the confirmed range');
  }
}

function assertMealSnapshot(meal: Meal): void {
  assertBoundedText(meal.id, 'meal id', FOOD_SNAPSHOT_LIMITS.id);
  if (!MEAL_SLOTS.includes(meal.slot)) throw new Error('meal slot is invalid');
  const expectedId = checkedMealId(meal.date, meal.slot);
  if (meal.id !== expectedId) throw new Error('meal id must be deterministic');
  assertSafeTimestamp(meal.updatedAt, 'meal updatedAt');
  assertNullableSafeTimestamp(meal.deletedAt, 'meal deletedAt');
  if (meal.deletedAt !== null && meal.deletedAt > meal.updatedAt) {
    throw new Error('meal deletedAt must not exceed updatedAt');
  }
}

function buildConfirmedItem(
  input: SaveConfirmedFoodItemInput,
  id: string,
  parentId: string,
  order: number,
  now: number,
): MealItem {
  assertFoodSnapshot(input.food);
  if (id !== mealItemId(input.operationId)) {
    throw new Error('new meal item id must match its operation id');
  }
  if (input.food.deletedAt !== null) throw new Error('food must be active');
  if (!Number.isInteger(order) || order < 0 || order > 10_000) {
    throw new Error('meal item order must be an integer between 0 and 10000');
  }
  requireSafeTimestamp(now, 'meal item timestamp');
  const nutrients = scaleFood(input.food, input.amount);
  const row: MealItem = {
    id,
    mealId: parentId,
    name: input.food.name,
    preparation: input.food.preparation,
    amount: input.amount,
    unit: input.food.basisUnit,
    originalEnergyValue: input.food.originalEnergyValue,
    originalEnergyUnit: input.food.originalEnergyUnit,
    originalProteinG: input.food.originalProteinG,
    originalBasisAmount: input.food.originalBasisAmount,
    originalBasisUnit: input.food.originalBasisUnit,
    energyKcal: input.food.energyKcal,
    proteinG: input.food.proteinG,
    energyKcalLow: nutrients.energyKcal,
    energyKcalHigh: nutrients.energyKcal,
    proteinGLow: nutrients.proteinG,
    proteinGHigh: nutrients.proteinG,
    assumptions: [
      `用户确认可食部${input.food.basisUnit}`,
      `食物目录快照 ${input.food.id}`,
    ],
    uncertaintyModelVersion: 'exact-measured-v1',
    basisAmount: input.food.basisAmount,
    basisUnit: input.food.basisUnit,
    ediblePortionRatio: input.food.ediblePortionRatio,
    densityGPerMl: input.food.densityGPerMl,
    conversionAssumptions: [...input.food.conversionAssumptions],
    fdcId: input.food.fdcId,
    fdcDataType: input.food.fdcDataType,
    sourceRetrievedAt: input.food.sourceRetrievedAt,
    source: input.food.source,
    sourceVersion: input.food.sourceVersion,
    license: input.food.license,
    method: input.food.preset
      ? 'preset'
      : input.food.source === 'user-label'
        ? 'label'
        : 'manual',
    quality: 'A',
    confirmedAt: now,
    order,
    updatedAt: now,
    deletedAt: null,
  };
  assertMealItemSnapshot(row);
  return row;
}

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('photo blob could not be read'));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error('photo blob did not decode to bytes'));
    };
    reader.readAsArrayBuffer(blob);
  });
}

async function validatePhoto(photo: MealPhoto): Promise<void> {
  if (
    typeof photo.id !== 'string' ||
    typeof photo.mealId !== 'string' ||
    photo.id !== mealPhotoId(photo.mealId)
  ) {
    throw new Error('photo id must be deterministic');
  }
  if (
    !(photo.thumbnail instanceof Blob) ||
    photo.thumbnail.size === 0 ||
    photo.thumbnail.size > 100 * 1024 ||
    photo.thumbnail.type !== 'image/webp' ||
    !Number.isSafeInteger(photo.size) ||
    photo.size <= 0 ||
    photo.size !== photo.thumbnail.size
  ) {
    throw new Error('photo thumbnail metadata is invalid');
  }
  if (
    !Number.isSafeInteger(photo.width) ||
    photo.width <= 0 ||
    photo.width > 320 ||
    !Number.isSafeInteger(photo.height) ||
    photo.height <= 0 ||
    photo.height > 320
  ) {
    throw new Error('photo dimensions are invalid');
  }
  if (
    typeof photo.mealSnapshotHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(photo.mealSnapshotHash)
  ) {
    throw new Error('photo meal snapshot hash is invalid');
  }
  requireSafeTimestamp(photo.updatedAt, 'photo updatedAt');
  const header = new Uint8Array(await readBlob(photo.thumbnail));
  if (
    header.length < 12 ||
    header[0] !== 82 ||
    header[1] !== 73 ||
    header[2] !== 70 ||
    header[3] !== 70 ||
    header[8] !== 87 ||
    header[9] !== 69 ||
    header[10] !== 66 ||
    header[11] !== 80
  ) {
    throw new Error('photo thumbnail must contain RIFF/WEBP magic bytes');
  }
}

async function samePhoto(left: MealPhoto, right: MealPhoto): Promise<boolean> {
  const leftMetadata = { ...left, thumbnail: undefined };
  const rightMetadata = { ...right, thumbnail: undefined };
  if (
    stableJson(leftMetadata) !== stableJson(rightMetadata) ||
    !(right.thumbnail instanceof Blob)
  ) {
    return false;
  }
  // fake-indexeddb/jsdom may lose the Blob prototype on readback. All durable
  // metadata is still compared there; real browser Blob rows additionally compare bytes.
  if (!(left.thumbnail instanceof Blob)) return true;
  if (left.thumbnail.type !== right.thumbnail.type) return false;
  const [leftBytes, rightBytes] = await Promise.all([
    readBlob(left.thumbnail),
    readBlob(right.thumbnail),
  ]);
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  const leftView = new Uint8Array(leftBytes);
  const rightView = new Uint8Array(rightBytes);
  return leftView.every((byte, index) => byte === rightView[index]);
}

function snapshotConfirmInput(input: ConfirmPhotoEstimateInput): ConfirmPhotoEstimateInput {
  try {
    const sourceBlob = input.thumbnail.blob;
    if (!(sourceBlob instanceof Blob)) throw new Error('thumbnail must be a Blob');
    const snapshot = structuredClone(input);
    snapshot.thumbnail.blob = sourceBlob.slice(0, sourceBlob.size, sourceBlob.type);
    return snapshot;
  } catch {
    throw new Error('photo confirmation input is invalid');
  }
}

function validateConfirmInput(input: ConfirmPhotoEstimateInput): string {
  const parentId = checkedMealId(input.date, input.slot);
  operationKey(input.operationId);
  assertBoundedText(input.requestId, 'photo confirmation request id', 200);
  if (!/^[a-f0-9]{64}$/.test(input.uploadBlobSha256)) {
    throw new Error('photo confirmation upload hash is invalid');
  }
  if (!Array.isArray(input.candidates) || input.candidates.length < 1 || input.candidates.length > 6) {
    throw new Error('photo confirmation requires 1-6 candidates');
  }
  input.candidates.forEach((_candidate, index) => {
    operationKey(`${input.operationId}_${index}`);
  });
  if (
    typeof input.thumbnail !== 'object' ||
    input.thumbnail === null ||
    !(input.thumbnail.blob instanceof Blob)
  ) {
    throw new Error('photo confirmation thumbnail is invalid');
  }
  return parentId;
}

function assertSelectedCandidates(
  selected: ConfirmedPhotoCandidate[],
  estimate: MealEstimate,
): void {
  const storedById = new Map(estimate.candidates.map((candidate) => [candidate.id, candidate]));
  const selectedIds = new Set<string>();
  for (const confirmed of selected) {
    const id = confirmed?.candidate?.id;
    if (typeof id !== 'string' || selectedIds.has(id)) {
      throw new Error('photo confirmation candidate conflict');
    }
    const stored = storedById.get(id);
    if (stored === undefined || stableJson(stored) !== stableJson(confirmed.candidate)) {
      throw new Error('photo confirmation candidate conflict');
    }
    selectedIds.add(id);
  }
}

function validateCandidate(
  candidate: MealEstimate['candidates'][number],
  candidateIds: Set<string>,
): void {
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof candidate.id !== 'string' ||
    candidate.id.trim().length === 0 ||
    candidate.id.length > 200 ||
    candidateIds.has(candidate.id) ||
    typeof candidate.name !== 'string' ||
    candidate.name.trim().length === 0 ||
    candidate.name.length > 120 ||
    typeof candidate.preparation !== 'string' ||
    candidate.preparation.length > 120 ||
    !Number.isFinite(candidate.amountLow) ||
    !Number.isFinite(candidate.amountHigh) ||
    candidate.amountLow < 0.01 ||
    candidate.amountHigh > 100_000 ||
    candidate.amountHigh < candidate.amountLow ||
    (candidate.unit !== 'g' && candidate.unit !== 'mL') ||
    (candidate.catalogFoodId !== null &&
      (typeof candidate.catalogFoodId !== 'string' ||
        candidate.catalogFoodId.trim().length === 0 ||
        candidate.catalogFoodId.length > 200))
  ) {
    throw new Error('estimate candidate is invalid');
  }
  candidateIds.add(candidate.id);
}

function validateEstimate(estimate: MealEstimate): void {
  if (
    typeof estimate.id !== 'string' ||
    typeof estimate.mealId !== 'string' ||
    estimate.id !== mealEstimateId(estimate.mealId)
  ) {
    throw new Error('estimate id must be deterministic');
  }
  if (
    typeof estimate.requestId !== 'string' ||
    estimate.requestId.trim().length === 0 ||
    estimate.requestId.length > 200
  ) {
    throw new Error('estimate request id must not be blank');
  }
  if (
    estimate.requestFingerprint !== null &&
    (typeof estimate.requestFingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(estimate.requestFingerprint))
  ) {
    throw new Error('estimate request fingerprint is invalid');
  }
  if (!ESTIMATE_STATUSES.has(estimate.status)) {
    throw new Error('estimate status is invalid');
  }
  requireSafeTimestamp(estimate.updatedAt, 'estimate updatedAt');
  if (!Array.isArray(estimate.candidates)) {
    throw new Error('estimate candidates must be an array');
  }
  if (estimate.candidates.length > 30) {
    throw new Error('estimate candidates must contain at most 30 items');
  }
  const candidateIds = new Set<string>();
  for (const candidate of estimate.candidates) validateCandidate(candidate, candidateIds);

  if (estimate.consent !== null) {
    const consent = estimate.consent;
    if (typeof consent !== 'object') throw new Error('estimate consent is invalid');
    if (consent.requestId !== estimate.requestId) {
      throw new Error('estimate consent request does not match estimate request');
    }
    if (
      typeof consent.uploadBlobSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(consent.uploadBlobSha256) ||
      typeof consent.providerPolicyVersion !== 'string' ||
      consent.providerPolicyVersion.trim().length === 0 ||
      consent.providerPolicyVersion.length > 500
    ) {
      throw new Error('estimate consent is invalid');
    }
    requireSafeTimestamp(consent.consentedAt, 'estimate consent consentedAt');
    requireSafeTimestamp(consent.expiresAt, 'estimate consent expiresAt');
    if (consent.expiresAt <= consent.consentedAt) {
      throw new Error('estimate consent expiry is invalid');
    }
  }

  if (estimate.error !== null && !ESTIMATE_ERRORS.has(estimate.error)) {
    throw new Error('estimate error is invalid');
  }
  if ((estimate.status === 'failed') !== (estimate.error !== null)) {
    throw new Error('estimate error must match failed status');
  }

  const hasConsent = estimate.consent !== null;
  const hasCandidates = estimate.candidates.length > 0;
  const hasFingerprint = estimate.requestFingerprint !== null;
  const stateIsValid =
    ((estimate.status === 'preprocessing' || estimate.status === 'awaiting-consent') &&
      !hasConsent &&
      !hasCandidates &&
      !hasFingerprint) ||
    ((estimate.status === 'uploading' || estimate.status === 'estimating') &&
      hasConsent &&
      !hasCandidates &&
      !hasFingerprint) ||
    (estimate.status === 'needs-confirmation' &&
      hasConsent &&
      hasCandidates &&
      hasFingerprint) ||
    (estimate.status === 'confirmed' &&
      !hasConsent &&
      !hasCandidates &&
      hasFingerprint) ||
    (estimate.status === 'failed' && !hasCandidates);
  if (!stateIsValid) throw new Error('estimate state fields are inconsistent');
}

const ESTIMATE_STATUS_RANK: Partial<Record<MealEstimateStatus, number>> = {
  preprocessing: 0,
  'awaiting-consent': 1,
  uploading: 2,
  estimating: 3,
  'needs-confirmation': 4,
  confirmed: 5,
};

function assertEstimateTransition(
  previous: MealEstimateStatus,
  next: MealEstimateStatus,
): void {
  if (previous === next) return;
  if (previous === 'confirmed' || previous === 'failed') {
    throw new Error('estimate state transition cannot leave a terminal state');
  }
  if (next === 'failed') return;
  const previousRank = ESTIMATE_STATUS_RANK[previous];
  const nextRank = ESTIMATE_STATUS_RANK[next];
  if (previousRank === undefined || nextRank === undefined || nextRank < previousRank) {
    throw new Error('estimate state transition cannot move backward');
  }
}

function assertStoredRanges(item: MealItem): void {
  requireFiniteNonNegative(item.energyKcalLow, 'stored energyKcalLow');
  requireFiniteNonNegative(item.energyKcalHigh, 'stored energyKcalHigh');
  requireFiniteNonNegative(item.proteinGLow, 'stored proteinGLow');
  requireFiniteNonNegative(item.proteinGHigh, 'stored proteinGHigh');
  if (item.energyKcalLow > item.energyKcalHigh) {
    throw new Error('stored energy range must be ascending');
  }
  if (item.proteinGLow > item.proteinGHigh) {
    throw new Error('stored protein range must be ascending');
  }
}

function scaleStoredRanges(item: MealItem, factor: number): Pick<
  MealItem,
  'energyKcalLow' | 'energyKcalHigh' | 'proteinGLow' | 'proteinGHigh'
> {
  requirePositive(factor, 'amount scaling factor');
  const scaled = {
    energyKcalLow: item.energyKcalLow * factor,
    energyKcalHigh: item.energyKcalHigh * factor,
    proteinGLow: item.proteinGLow * factor,
    proteinGHigh: item.proteinGHigh * factor,
  };
  requireFiniteNonNegative(scaled.energyKcalLow, 'scaled energyKcalLow');
  requireFiniteNonNegative(scaled.energyKcalHigh, 'scaled energyKcalHigh');
  requireFiniteNonNegative(scaled.proteinGLow, 'scaled proteinGLow');
  requireFiniteNonNegative(scaled.proteinGHigh, 'scaled proteinGHigh');
  return scaled;
}

export function createMealRepo(database: NutritionDb): MealRepository {
  async function save(input: SaveConfirmedFoodItemInput): Promise<MealItem> {
    const snapshot = structuredClone(input);
    const op = operationKey(snapshot.operationId);
    assertFiniteRange(snapshot.amount, 'amount', 0.01, 100_000);
    assertFoodSnapshot(snapshot.food);
    const parentId = checkedMealId(snapshot.date, snapshot.slot);
    const itemId = mealItemId(op);

    return database.transaction('rw', [database.meals, database.mealItems], async () => {
      const existingItem = await database.mealItems.get(itemId);
      if (existingItem !== undefined) assertMealItemSnapshot(existingItem);
      const comparison = buildConfirmedItem(
        snapshot,
        itemId,
        parentId,
        existingItem?.order ?? 0,
        0,
      );
      if (existingItem !== undefined && itemSemantic(existingItem) !== itemSemantic(comparison)) {
        throw new Error('operation id conflict');
      }

      const existingMeal = await database.meals.get(parentId);
      if (
        existingMeal !== undefined &&
        (existingMeal.date !== snapshot.date || existingMeal.slot !== snapshot.slot)
      ) {
        throw new Error('meal id conflict');
      }
      if (existingMeal !== undefined) assertMealSnapshot(existingMeal);

      if (existingItem?.deletedAt === null) {
        if (existingMeal === undefined || existingMeal.deletedAt !== null) {
          const now = operationTimestamp(
            existingItem.updatedAt,
            existingItem.confirmedAt,
            existingMeal?.updatedAt,
            existingMeal?.deletedAt,
          );
          await database.meals.put({
            id: parentId,
            date: snapshot.date,
            slot: snapshot.slot,
            updatedAt: now,
            deletedAt: null,
          });
        }
        return existingItem;
      }

      const activeSiblings = (
        await database.mealItems.where('mealId').equals(parentId).toArray()
      ).filter((item) => item.deletedAt === null);
      for (const sibling of activeSiblings) {
        assertMealItemSnapshot(sibling);
      }
      const order =
        activeSiblings.reduce((maximum, item) => Math.max(maximum, item.order), -1) + 1;
      if (!Number.isInteger(order) || order > 10_000) {
        throw new Error('meal item order must be an integer between 0 and 10000');
      }

      const now = operationTimestamp(
        existingItem?.updatedAt,
        existingItem?.confirmedAt,
        existingItem?.deletedAt,
        existingMeal?.updatedAt,
        existingMeal?.deletedAt,
      );
      const meal: Meal = {
        id: parentId,
        date: snapshot.date,
        slot: snapshot.slot,
        updatedAt: now,
        deletedAt: null,
      };
      const row = buildConfirmedItem(snapshot, itemId, parentId, order, now);
      if (existingItem !== undefined) {
        requireSafeTimestamp(existingItem.confirmedAt, 'existing confirmedAt');
        row.confirmedAt = existingItem.confirmedAt;
      }
      await database.meals.put(meal);
      await database.mealItems.put(row);
      return row;
    });
  }

  async function updateAmount(id: string, amount: number): Promise<MealItem> {
    assertFiniteRange(amount, 'amount / scaled energyKcalLow', 0.01, 100_000);
    return database.transaction('rw', [database.meals, database.mealItems], async () => {
      const existing = await database.mealItems.get(id);
      if (existing === undefined || existing.deletedAt !== null) {
        throw new Error('active meal item not found');
      }
      requirePositive(existing.amount, 'stored amount');
      assertStoredRanges(existing);
      assertMealItemSnapshot(existing);
      const meal = await database.meals.get(existing.mealId);
      if (meal === undefined || meal.deletedAt !== null) {
        throw new Error('meal item update requires an active parent meal');
      }
      assertMealSnapshot(meal);
      const scaled = scaleStoredRanges(existing, amount / existing.amount);
      const now = operationTimestamp(existing.updatedAt, meal.updatedAt);
      const row: MealItem = {
        ...existing,
        amount,
        ...scaled,
        updatedAt: now,
      };
      assertMealItemSnapshot(row);
      const parent = { ...meal, updatedAt: now };
      assertMealSnapshot(parent);
      await database.mealItems.put(row);
      await database.meals.put(parent);
      return row;
    });
  }

  async function removeItem(id: string): Promise<void> {
    await database.transaction(
      'rw',
      [database.meals, database.mealItems, database.mealPhotos, database.mealEstimates],
      async () => {
        const existing = await database.mealItems.get(id);
        if (existing === undefined || existing.deletedAt !== null) return;
        assertMealItemSnapshot(existing);
        const meal = await database.meals.get(existing.mealId);
        if (meal !== undefined) assertMealSnapshot(meal);
        const now = operationTimestamp(
          existing.updatedAt,
          meal?.updatedAt,
          meal?.deletedAt,
        );
        const tombstone = { ...existing, updatedAt: now, deletedAt: now };
        assertMealItemSnapshot(tombstone);
        await database.mealItems.put(tombstone);

        const activeSiblings = (
          await database.mealItems.where('mealId').equals(existing.mealId).toArray()
        ).filter((item) => item.deletedAt === null);
        activeSiblings.forEach(assertMealItemSnapshot);
        if (activeSiblings.length > 0) {
          if (meal !== undefined) {
            const parent = { ...meal, updatedAt: now };
            assertMealSnapshot(parent);
            await database.meals.put(parent);
          }
          return;
        }

        await database.mealPhotos.where('mealId').equals(existing.mealId).delete();
        await database.mealEstimates.where('mealId').equals(existing.mealId).delete();
        if (meal !== undefined) {
          const parent = { ...meal, updatedAt: now, deletedAt: now };
          assertMealSnapshot(parent);
          await database.meals.put(parent);
        }
      },
    );
  }

  async function removeWholeMeal(id: string): Promise<void> {
    await database.transaction(
      'rw',
      [database.meals, database.mealItems, database.mealPhotos, database.mealEstimates],
      async () => {
        const meal = await database.meals.get(id);
        if (meal !== undefined) assertMealSnapshot(meal);
        const activeItems = (
          await database.mealItems.where('mealId').equals(id).toArray()
        ).filter((item) => item.deletedAt === null);
        activeItems.forEach(assertMealItemSnapshot);

        const needsTombstones = activeItems.length > 0 || meal?.deletedAt === null;
        const now = needsTombstones
          ? operationTimestamp(
              meal?.updatedAt,
              meal?.deletedAt,
              ...activeItems.map((item) => item.updatedAt),
            )
          : undefined;
        if (now !== undefined && activeItems.length > 0) {
          const tombstones = activeItems.map((item) => ({
            ...item,
            updatedAt: now,
            deletedAt: now,
          }));
          tombstones.forEach(assertMealItemSnapshot);
          await database.mealItems.bulkPut(tombstones);
        }
        await database.mealPhotos.where('mealId').equals(id).delete();
        await database.mealEstimates.where('mealId').equals(id).delete();
        if (meal !== undefined && now !== undefined) {
          const tombstone = { ...meal, updatedAt: now, deletedAt: now };
          assertMealSnapshot(tombstone);
          await database.meals.put(tombstone);
        }
      },
    );
  }

  async function listDay(date: string): Promise<NutritionDay> {
    checkedMealId(date, 'breakfast');
    return database.transaction('r', [database.meals, database.mealItems], async () => {
      const meals = (await database.meals.where('date').equals(date).toArray()).filter(
        (meal) => meal.deletedAt === null,
      );
      if (new Set(meals.map((meal) => meal.slot)).size !== meals.length) {
        throw new Error('duplicate meal slot for nutrition day');
      }
      meals.forEach(assertMealSnapshot);
      const mealIds = meals.map((meal) => meal.id);
      const items =
        mealIds.length === 0
          ? []
          : (await database.mealItems.where('mealId').anyOf(mealIds).toArray())
              .filter((item) => item.deletedAt === null)
              .map((item) => {
                assertMealItemSnapshot(item);
                if (!mealIds.includes(item.mealId)) {
                  throw new Error('meal item requires a matching active parent');
                }
                return item;
              })
              .sort(
                (left, right) =>
                  left.order - right.order || compareIds(left.id, right.id),
              );
      const mealBySlot = new Map(meals.map((meal) => [meal.slot, meal]));
      return {
        date,
        meals: MEAL_SLOTS.map((slot) => {
          const meal = mealBySlot.get(slot);
          return {
            slot,
            meal,
            items:
              meal === undefined ? [] : items.filter((item) => item.mealId === meal.id),
          };
        }),
        summary: summarizeNutritionDay(meals, items),
      };
    });
  }

  async function putPhoto(photo: MealPhoto): Promise<void> {
    const row = structuredClone(photo);
    if (!(row.thumbnail instanceof Blob) && photo.thumbnail instanceof Blob) {
      row.thumbnail = photo.thumbnail.slice(
        0,
        photo.thumbnail.size,
        photo.thumbnail.type,
      );
    }
    await validatePhoto(row);
    await database.transaction(
      'rw',
      [database.meals, database.mealItems, database.mealPhotos],
      async () => {
        const meal = await database.meals.get(row.mealId);
        if (meal === undefined || meal.deletedAt !== null) {
          throw new Error('photo requires an active meal');
        }
        const items = await database.mealItems.where('mealId').equals(row.mealId).toArray();
        items.filter((item) => item.deletedAt === null).forEach(assertMealItemSnapshot);
        const currentSnapshotHash = await Dexie.waitFor(buildMealSnapshotHash(meal, items));
        if (row.mealSnapshotHash !== currentSnapshotHash) {
          throw new Error('photo meal snapshot is stale');
        }

        const existing = await database.mealPhotos.get(row.id);
        if (existing !== undefined) {
          requireSafeTimestamp(existing.updatedAt, 'stored photo updatedAt');
          if (row.updatedAt < existing.updatedAt) throw new Error('stale photo update');
          if (row.updatedAt === existing.updatedAt) {
            if (await Dexie.waitFor(samePhoto(existing, row))) return;
            throw new Error('photo timestamp conflict');
          }
        }
        await database.mealPhotos.put(row);
      },
    );
  }

  async function putEstimate(estimate: MealEstimate): Promise<void> {
    const row = structuredClone(estimate);
    validateEstimate(row);
    parseMealId(row.mealId);
    if (row.status === 'confirmed') {
      throw new Error('confirmed estimates require atomic photo confirmation');
    }
    await database.transaction('rw', [database.mealEstimates], async () => {
      const existing = await database.mealEstimates.get(row.id);
      if (existing !== undefined) {
        validateEstimate(existing);
        if (row.updatedAt < existing.updatedAt) throw new Error('stale estimate update');
        if (row.requestId !== existing.requestId) {
          throw new Error('estimate request changed; clear temporary state before a new request');
        }
        if (row.updatedAt === existing.updatedAt) {
          if (stableJson(row) === stableJson(existing)) return;
          throw new Error('estimate timestamp conflict');
        }
        assertEstimateTransition(existing.status, row.status);
        if (
          row.requestFingerprint !== existing.requestFingerprint &&
          !(
            existing.status === 'estimating' &&
            row.status === 'needs-confirmation' &&
            existing.requestFingerprint === null &&
            row.requestFingerprint !== null
          )
        ) {
          throw new Error('estimate fingerprint transition is invalid');
        }
      }
      await database.mealEstimates.put(row);
    });
  }

  async function clearTemporary(mealId: string): Promise<void> {
    await database.transaction(
      'rw',
      [database.mealPhotos, database.mealEstimates],
      async () => {
        await database.mealPhotos.where('mealId').equals(mealId).delete();
        await database.mealEstimates.where('mealId').equals(mealId).delete();
      },
    );
  }

  async function confirmPhoto(
    input: ConfirmPhotoEstimateInput,
  ): Promise<MealItem[]> {
    const snapshot = snapshotConfirmInput(input);
    const parentId = validateConfirmInput(snapshot);
    const estimateId = mealEstimateId(parentId);
    const itemIds = snapshot.candidates.map((_candidate, index) =>
      mealItemId(operationKey(`${snapshot.operationId}_${index}`)),
    );

    const committed = await database.transaction(
      'rw',
      [
        database.foods,
        database.meals,
        database.mealItems,
        database.mealPhotos,
        database.mealEstimates,
      ],
      async () => {
        const estimate = await database.mealEstimates.get(estimateId);
        if (estimate === undefined) throw new Error('photo estimate not found');
        validateEstimate(estimate);
        if (estimate.requestId !== snapshot.requestId) {
          throw new Error('photo estimate request conflict');
        }

        const meal = await database.meals.get(parentId);
        if (meal !== undefined) assertMealSnapshot(meal);
        const allItems = await database.mealItems.where('mealId').equals(parentId).toArray();
        allItems.forEach(assertMealItemSnapshot);
        const globallyExistingItems = await database.mealItems.bulkGet(itemIds);
        globallyExistingItems
          .filter((item): item is MealItem => item !== undefined)
          .forEach(assertMealItemSnapshot);

        async function buildRows(orders: number[], now: number): Promise<MealItem[]> {
          const rows: MealItem[] = [];
          for (let index = 0; index < snapshot.candidates.length; index += 1) {
            const confirmed = snapshot.candidates[index]!;
            const catalogFoodId = confirmed.candidate.catalogFoodId;
            const food =
              catalogFoodId === null
                ? undefined
                : await database.foods.get(catalogFoodId);
            const row = buildPhotoMealItem(confirmed, food, {
              id: itemIds[index]!,
              mealId: parentId,
              order: orders[index]!,
              now,
            });
            assertMealItemSnapshot(row);
            rows.push(row);
          }
          return rows;
        }

        if (estimate.status === 'confirmed') {
          if (meal === undefined || meal.deletedAt !== null) {
            throw new Error('confirmed photo estimate is missing its active meal');
          }
          const operationPrefix = `meal-item:${snapshot.operationId}_`;
          const operationRows = allItems.filter((item) => {
            if (item.method !== 'ai-confirmed' || !item.id.startsWith(operationPrefix)) {
              return false;
            }
            return /^\d+$/.test(item.id.slice(operationPrefix.length));
          });
          if (
            operationRows.length !== itemIds.length ||
            operationRows.some((item) => !itemIds.includes(item.id))
          ) {
            throw new Error('photo confirmation operation conflict');
          }
          const existingRows = globallyExistingItems;
          if (existingRows.some((row) => row === undefined || row.deletedAt !== null)) {
            throw new Error('photo confirmation operation conflict');
          }
          const rows = existingRows as MealItem[];
          if (rows.some((row) => row.mealId !== parentId)) {
            throw new Error('photo confirmation operation conflict');
          }
          const desired = await buildRows(
            rows.map((row) => row.order),
            rows[0]!.confirmedAt,
          );
          if (
            rows.some((row, index) => itemSemantic(row) !== itemSemantic(desired[index]!))
          ) {
            throw new Error('photo confirmation operation conflict');
          }
          const photo = await database.mealPhotos.get(mealPhotoId(parentId));
          if (photo === undefined) throw new Error('confirmed photo estimate is missing its photo');
          const comparison: MealPhoto = {
            ...photo,
            thumbnail: snapshot.thumbnail.blob,
            size: snapshot.thumbnail.blob.size,
            width: snapshot.thumbnail.width,
            height: snapshot.thumbnail.height,
          };
          await Dexie.waitFor(validatePhoto(comparison));
          const same = await Dexie.waitFor(
            samePhoto(photo, comparison),
          );
          if (!same) throw new Error('photo confirmation thumbnail conflict');
          return rows;
        }

        if (estimate.status !== 'needs-confirmation') {
          throw new Error('photo estimate must be in needs-confirmation state');
        }
        if (estimate.consent === null) throw new Error('photo estimate consent is missing');
        if (estimate.consent.uploadBlobSha256 !== snapshot.uploadBlobSha256) {
          throw new Error('photo estimate upload hash conflict');
        }
        const wallNow = Date.now();
        requireSafeTimestamp(wallNow, 'Date.now()');
        if (wallNow >= estimate.consent.expiresAt) {
          throw new Error('photo estimate consent expired');
        }
        assertSelectedCandidates(snapshot.candidates, estimate);

        const activeSiblings = allItems.filter((item) => item.deletedAt === null);
        const activeOrders = activeSiblings.map((item) => item.order);
        if (new Set(activeOrders).size !== activeOrders.length) {
          throw new Error('active meal item orders must be unique');
        }
        if (globallyExistingItems.some((item) => item !== undefined)) {
          throw new Error('photo confirmation operation conflict');
        }
        const firstOrder =
          activeSiblings.reduce((maximum, item) => Math.max(maximum, item.order), -1) + 1;
        const orders = snapshot.candidates.map((_candidate, index) => firstOrder + index);
        if (orders.some((order) => !Number.isInteger(order) || order > 10_000)) {
          throw new Error('meal item order must be an integer between 0 and 10000');
        }

        const existingPhoto = await database.mealPhotos.get(mealPhotoId(parentId));
        if (existingPhoto !== undefined) await validatePhoto(existingPhoto);
        const floors = [
          estimate.updatedAt,
          meal?.updatedAt,
          meal?.deletedAt,
          existingPhoto?.updatedAt,
          ...allItems.flatMap((item) => [item.updatedAt, item.confirmedAt, item.deletedAt]),
        ];
        let now = wallNow;
        for (const floor of floors) {
          if (floor === null || floor === undefined) continue;
          requireSafeTimestamp(floor, 'stored timestamp');
          now = Math.max(now, floor);
        }

        const rows = await buildRows(orders, now);
        const parent: Meal = {
          id: parentId,
          date: snapshot.date,
          slot: snapshot.slot,
          updatedAt: now,
          deletedAt: null,
        };
        assertMealSnapshot(parent);
        await database.meals.put(parent);
        await database.mealItems.bulkPut(rows);

        const mealSnapshotHash = await Dexie.waitFor(
          buildMealSnapshotHash(parent, [...allItems, ...rows]),
        );
        const photo: MealPhoto = {
          id: mealPhotoId(parentId),
          mealId: parentId,
          thumbnail: snapshot.thumbnail.blob,
          size: snapshot.thumbnail.blob.size,
          width: snapshot.thumbnail.width,
          height: snapshot.thumbnail.height,
          mealSnapshotHash,
          updatedAt: now,
        };
        await Dexie.waitFor(validatePhoto(photo));
        await database.mealPhotos.put(photo);

        const confirmedEstimate: MealEstimate = {
          ...estimate,
          status: 'confirmed',
          candidates: [],
          consent: null,
          error: null,
          updatedAt: now,
        };
        validateEstimate(confirmedEstimate);
        await database.mealEstimates.put(confirmedEstimate);
        return rows;
      },
    );
    return structuredClone(committed);
  }

  async function clearEstimate(mealId: string): Promise<void> {
    parseMealId(mealId);
    await database.transaction('rw', [database.mealEstimates], async () => {
      await database.mealEstimates.delete(mealEstimateId(mealId));
    });
  }

  return {
    saveConfirmedFoodItem: save,
    updateMealItemAmount: updateAmount,
    removeMealItem: removeItem,
    removeMeal: removeWholeMeal,
    listNutritionDay: listDay,
    putMealPhoto: putPhoto,
    putMealEstimate: putEstimate,
    clearMealTemporaryState: clearTemporary,
    confirmPhotoEstimate: confirmPhoto,
    clearMealEstimate: clearEstimate,
  };
}

const defaultRepo = createMealRepo(db);

export const saveConfirmedFoodItem = (
  input: SaveConfirmedFoodItemInput,
): Promise<MealItem> => defaultRepo.saveConfirmedFoodItem(input);
export const updateMealItemAmount = (id: string, amount: number): Promise<MealItem> =>
  defaultRepo.updateMealItemAmount(id, amount);
export const removeMealItem = (id: string): Promise<void> =>
  defaultRepo.removeMealItem(id);
export const removeMeal = (id: string): Promise<void> => defaultRepo.removeMeal(id);
export const listNutritionDay = (date: string): Promise<NutritionDay> =>
  defaultRepo.listNutritionDay(date);
export const putMealPhoto = (photo: MealPhoto): Promise<void> =>
  defaultRepo.putMealPhoto(photo);
export const putMealEstimate = (estimate: MealEstimate): Promise<void> =>
  defaultRepo.putMealEstimate(estimate);
export const clearMealTemporaryState = (mealId: string): Promise<void> =>
  defaultRepo.clearMealTemporaryState(mealId);
export const confirmPhotoEstimate = (
  input: ConfirmPhotoEstimateInput,
): Promise<MealItem[]> => defaultRepo.confirmPhotoEstimate(input);
export const clearMealEstimate = (mealId: string): Promise<void> =>
  defaultRepo.clearMealEstimate(mealId);
