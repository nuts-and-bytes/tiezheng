import { normalizeFoodNutrients } from './foodNormalization';
import type { Food, FoodDataType } from './nutritionTypes';

export const FOOD_SNAPSHOT_LIMITS = {
  id: 200,
  label: 120,
  text: 500,
  arrayItems: 30,
  originalEnergyValue: 1_000_000,
  originalProteinG: 100_000,
  basisAmount: 100_000,
  energyKcal: 100_000,
  proteinG: 10_000,
  densityGPerMl: 100,
} as const;

const RAW_OR_COOKED = new Set<Food['rawOrCooked']>([
  'raw',
  'cooked',
  'not-applicable',
]);
const FOOD_DATA_TYPES = new Set<FoodDataType>([
  'SR Legacy',
  'Foundation',
  'Survey (FNDDS)',
  'Branded',
]);

export interface NutrientSnapshot {
  originalEnergyValue: number;
  originalEnergyUnit: Food['originalEnergyUnit'];
  originalProteinG: number;
  originalBasisAmount: number;
  originalBasisUnit: Food['originalBasisUnit'];
  basisAmount: number;
  basisUnit: Food['basisUnit'];
  energyKcal: number;
  proteinG: number;
  ediblePortionRatio: number;
  densityGPerMl: number | null;
  conversionAssumptions: string[];
  fdcId: number | null;
  fdcDataType: FoodDataType | null;
  sourceRetrievedAt: string | null;
}

export function assertBoundedText(
  value: unknown,
  field: string,
  maximum: number = FOOD_SNAPSHOT_LIMITS.text,
  allowBlank = false,
): asserts value is string {
  if (typeof value !== 'string') throw new Error(`${field} must be text`);
  if (!allowBlank && value.trim().length === 0) throw new Error(`${field} must not be blank`);
  if (value.length > maximum) throw new Error(`${field} must contain at most ${maximum} characters`);
}

export function assertBoundedStringArray(
  value: unknown,
  field: string,
  maximum: number = FOOD_SNAPSHOT_LIMITS.arrayItems,
): asserts value is string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  if (value.length > maximum) throw new Error(`${field} must contain at most ${maximum} items`);
  value.forEach((entry, index) =>
    assertBoundedText(entry, `${field}[${index}]`, FOOD_SNAPSHOT_LIMITS.text, true),
  );
}

export function assertFiniteRange(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be finite`);
  }
  if (value < minimum || value > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}`);
  }
}

export function assertSafeTimestamp(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe timestamp`);
  }
}

export function assertNullableSafeTimestamp(
  value: unknown,
  field: string,
): asserts value is number | null {
  if (value !== null) assertSafeTimestamp(value, field);
}

function assertRealDate(value: unknown, field: string): asserts value is string {
  assertBoundedText(value, field, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`${field} must be YYYY-MM-DD`);
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${field} must be a real calendar date`);
  }
}

export function assertNutrientSnapshot(
  snapshot: NutrientSnapshot,
  label = 'food',
): void {
  assertFiniteRange(
    snapshot.originalEnergyValue,
    `${label} originalEnergyValue`,
    0,
    FOOD_SNAPSHOT_LIMITS.originalEnergyValue,
  );
  if (snapshot.originalEnergyUnit !== 'kcal' && snapshot.originalEnergyUnit !== 'kJ') {
    throw new Error(`${label} originalEnergyUnit is invalid`);
  }
  assertFiniteRange(
    snapshot.originalProteinG,
    `${label} originalProteinG`,
    0,
    FOOD_SNAPSHOT_LIMITS.originalProteinG,
  );
  assertFiniteRange(
    snapshot.originalBasisAmount,
    `${label} originalBasisAmount`,
    0.01,
    FOOD_SNAPSHOT_LIMITS.basisAmount,
  );
  if (snapshot.originalBasisUnit !== 'g' && snapshot.originalBasisUnit !== 'mL') {
    throw new Error(`${label} originalBasisUnit is invalid`);
  }
  assertFiniteRange(
    snapshot.basisAmount,
    `${label} basisAmount`,
    0.01,
    FOOD_SNAPSHOT_LIMITS.basisAmount,
  );
  if (snapshot.basisUnit !== 'g' && snapshot.basisUnit !== 'mL') {
    throw new Error(`${label} basisUnit is invalid`);
  }
  assertFiniteRange(
    snapshot.energyKcal,
    `${label} scaled energyKcal`,
    0,
    FOOD_SNAPSHOT_LIMITS.energyKcal,
  );
  assertFiniteRange(
    snapshot.proteinG,
    `${label} scaled proteinG`,
    0,
    FOOD_SNAPSHOT_LIMITS.proteinG,
  );
  assertFiniteRange(snapshot.ediblePortionRatio, `${label} ediblePortionRatio`, Number.MIN_VALUE, 1);
  if (snapshot.densityGPerMl !== null) {
    assertFiniteRange(
      snapshot.densityGPerMl,
      `${label} densityGPerMl`,
      Number.MIN_VALUE,
      FOOD_SNAPSHOT_LIMITS.densityGPerMl,
    );
  }
  assertBoundedStringArray(snapshot.conversionAssumptions, `${label} conversionAssumptions`);

  if (snapshot.fdcId !== null) {
    if (!Number.isSafeInteger(snapshot.fdcId) || snapshot.fdcId <= 0) {
      throw new Error(`${label} fdcId must be a positive safe integer or null`);
    }
  }
  if (snapshot.fdcDataType !== null && !FOOD_DATA_TYPES.has(snapshot.fdcDataType)) {
    throw new Error(`${label} fdcDataType is invalid`);
  }
  if ((snapshot.fdcId === null) !== (snapshot.fdcDataType === null)) {
    throw new Error(`${label} fdcId and fdcDataType must be provided together`);
  }
  if (snapshot.sourceRetrievedAt !== null) {
    assertRealDate(snapshot.sourceRetrievedAt, `${label} sourceRetrievedAt`);
  }
  if (snapshot.fdcId !== null && snapshot.sourceRetrievedAt === null) {
    throw new Error(`${label} sourceRetrievedAt is required for fdc data`);
  }

  const normalized = normalizeFoodNutrients({
    originalEnergyValue: snapshot.originalEnergyValue,
    originalEnergyUnit: snapshot.originalEnergyUnit,
    originalProteinG: snapshot.originalProteinG,
    originalBasisAmount: snapshot.originalBasisAmount,
    originalBasisUnit: snapshot.originalBasisUnit,
    normalizedBasisAmount: snapshot.basisAmount,
    normalizedBasisUnit: snapshot.basisUnit,
    ediblePortionRatio: snapshot.ediblePortionRatio,
    densityGPerMl: snapshot.densityGPerMl,
    conversionAssumptions: [],
  });
  if (
    Math.abs(snapshot.energyKcal - normalized.energyKcal) > 1e-6 ||
    Math.abs(snapshot.proteinG - normalized.proteinG) > 1e-6
  ) {
    throw new Error(`${label} normalized nutrient values are inconsistent with source values`);
  }
}

export function assertFoodSnapshot(food: Food): void {
  if (typeof food !== 'object' || food === null) throw new Error('food must be an object');
  assertBoundedText(food.id, 'food id', FOOD_SNAPSHOT_LIMITS.id);
  assertBoundedText(food.name, 'food name', FOOD_SNAPSHOT_LIMITS.label);
  assertBoundedStringArray(food.aliases, 'food aliases');
  if (!RAW_OR_COOKED.has(food.rawOrCooked)) throw new Error('food rawOrCooked is invalid');
  assertBoundedText(food.preparation, 'food preparation', FOOD_SNAPSHOT_LIMITS.label, true);
  assertNutrientSnapshot(food, 'food');
  assertBoundedText(food.source, 'food source');
  assertBoundedText(food.sourceVersion, 'food sourceVersion');
  assertBoundedText(food.license, 'food license');
  if (typeof food.preset !== 'boolean') throw new Error('food preset must be boolean');
  assertSafeTimestamp(food.updatedAt, 'food updatedAt');
  assertNullableSafeTimestamp(food.deletedAt, 'food deletedAt');
  if (food.deletedAt !== null && food.deletedAt > food.updatedAt) {
    throw new Error('food deletedAt must not exceed updatedAt');
  }
}
