import { PRESET_FOODS } from '../data/presetFoods';
import { db } from '../lib/db';
import {
  normalizeFoodNutrients,
  type FoodNormalizationInput,
} from '../lib/foodNormalization';
import { assertFoodSnapshot } from '../lib/foodSnapshotValidation';
import { operationKey } from '../lib/nutritionIds';
import { stableJson } from '../lib/stableJson';
import type { Food, FoodDataType } from '../lib/nutritionTypes';

export interface SaveCustomFoodInput extends FoodNormalizationInput {
  name: string;
  aliases: string[];
  rawOrCooked: Food['rawOrCooked'];
  preparation: string;
  fdcId: number | null;
  fdcDataType: FoodDataType | null;
  sourceRetrievedAt: string | null;
  source: string;
  sourceVersion: string;
  license: string;
}

const PRESET_ORDER = new Map(PRESET_FOODS.map((food, index) => [food.id, index]));
const MAX_TEXT_LENGTH = 500;
const MAX_FOOD_LABEL_LENGTH = 120;
const MAX_STRING_ARRAY_ITEMS = 30;
const RAW_OR_COOKED = new Set<Food['rawOrCooked']>(['raw', 'cooked', 'not-applicable']);
const FOOD_DATA_TYPES = new Set<FoodDataType>([
  'SR Legacy',
  'Foundation',
  'Survey (FNDDS)',
  'Branded',
]);

function boundedText(
  value: unknown,
  field: string,
  maxLength = MAX_TEXT_LENGTH,
  allowBlank = false,
): string {
  if (typeof value !== 'string') throw new Error(`${field} must be text`);
  if (value.length > maxLength) {
    throw new Error(`${field} must contain at most ${maxLength} characters`);
  }
  const trimmed = value.trim();
  if (!allowBlank && trimmed.length === 0) throw new Error(`${field} must not be blank`);
  return trimmed;
}

function assertFiniteRange(
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

function assertOptionalDensity(value: unknown): asserts value is number | null {
  if (value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('densityGPerMl must be finite or null');
  }
  if (value <= 0 || value > 100) {
    throw new Error('densityGPerMl must be greater than 0 and at most 100');
  }
}

function assertBoundedStringArray(
  value: unknown,
  field: string,
  allowBlankItems: boolean,
): asserts value is string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  if (value.length > MAX_STRING_ARRAY_ITEMS) {
    throw new Error(`${field} must contain at most ${MAX_STRING_ARRAY_ITEMS} items`);
  }
  value.forEach((entry, index) => {
    if (typeof entry !== 'string') throw new Error(`${field}[${index}] must be text`);
    if (entry.length > MAX_TEXT_LENGTH) {
      throw new Error(`${field}[${index}] must contain at most ${MAX_TEXT_LENGTH} characters`);
    }
    if (!allowBlankItems && entry.trim().length === 0) {
      throw new Error(`${field}[${index}] must not be blank`);
    }
  });
}

function validOptionalDate(value: unknown): asserts value is string | null {
  if (value === null) return;
  if (typeof value !== 'string') {
    throw new Error('sourceRetrievedAt must be text or null');
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('sourceRetrievedAt must be YYYY-MM-DD');

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
    throw new Error('sourceRetrievedAt must be a real date');
  }
}

function semanticFood(food: Food): Omit<Food, 'updatedAt' | 'deletedAt'> {
  const { updatedAt: _updatedAt, deletedAt: _deletedAt, ...semantic } = food;
  void _updatedAt;
  void _deletedAt;
  return semantic;
}

function buildCustomFood(id: string, input: SaveCustomFoodInput, now: number): Food {
  if (!RAW_OR_COOKED.has(input.rawOrCooked)) {
    throw new Error('rawOrCooked must be raw, cooked, or not-applicable');
  }
  if (input.fdcDataType !== null && !FOOD_DATA_TYPES.has(input.fdcDataType)) {
    throw new Error('fdcDataType is invalid');
  }
  validOptionalDate(input.sourceRetrievedAt);
  if (input.fdcId !== null && (!Number.isSafeInteger(input.fdcId) || input.fdcId <= 0)) {
    throw new Error('fdcId must be a positive safe integer or null');
  }
  if ((input.fdcId === null) !== (input.fdcDataType === null)) {
    throw new Error('fdcId and fdcDataType must be provided simultaneously or both be null');
  }
  if (input.fdcId !== null && input.sourceRetrievedAt === null) {
    throw new Error('sourceRetrievedAt is required for FDC data');
  }

  assertBoundedStringArray(input.aliases, 'aliases', true);
  assertBoundedStringArray(input.conversionAssumptions, 'conversionAssumptions', false);
  assertFiniteRange(input.originalEnergyValue, 'originalEnergyValue', 0, 1_000_000);
  assertFiniteRange(input.originalProteinG, 'originalProteinG', 0, 100_000);
  assertFiniteRange(input.originalBasisAmount, 'originalBasisAmount', 0.01, 100_000);
  assertFiniteRange(input.normalizedBasisAmount, 'normalizedBasisAmount', 0.01, 100_000);
  assertOptionalDensity(input.densityGPerMl);

  const normalized = normalizeFoodNutrients(input);
  assertFiniteRange(normalized.basisAmount, 'basisAmount', 0.01, 100_000);
  assertFiniteRange(normalized.energyKcal, 'energyKcal', 0, 100_000);
  assertFiniteRange(normalized.proteinG, 'proteinG', 0, 10_000);
  assertBoundedStringArray(
    normalized.conversionAssumptions,
    'conversionAssumptions',
    false,
  );
  return {
    id,
    name: boundedText(input.name, 'name', MAX_FOOD_LABEL_LENGTH),
    aliases: input.aliases.map((alias) => alias.trim()).filter(Boolean),
    rawOrCooked: input.rawOrCooked,
    preparation: boundedText(input.preparation, 'preparation', MAX_FOOD_LABEL_LENGTH, true),
    originalEnergyValue: input.originalEnergyValue,
    originalEnergyUnit: input.originalEnergyUnit,
    originalProteinG: input.originalProteinG,
    originalBasisAmount: input.originalBasisAmount,
    originalBasisUnit: input.originalBasisUnit,
    basisAmount: normalized.basisAmount,
    basisUnit: normalized.basisUnit,
    energyKcal: normalized.energyKcal,
    proteinG: normalized.proteinG,
    ediblePortionRatio: input.ediblePortionRatio,
    densityGPerMl: input.densityGPerMl,
    conversionAssumptions: normalized.conversionAssumptions,
    fdcId: input.fdcId,
    fdcDataType: input.fdcDataType,
    sourceRetrievedAt: input.sourceRetrievedAt,
    source: boundedText(input.source, 'source'),
    sourceVersion: boundedText(input.sourceVersion, 'sourceVersion'),
    license: boundedText(input.license, 'license'),
    preset: false,
    updatedAt: now,
    deletedAt: null,
  };
}

export async function seedPresetFoods(): Promise<void> {
  PRESET_FOODS.forEach(assertFoodSnapshot);
  await db.transaction('rw', db.foods, async () => {
    const existing = await db.foods.bulkGet(PRESET_FOODS.map((food) => food.id));
    const missing = PRESET_FOODS.filter((_food, index) => existing[index] === undefined);
    if (missing.length > 0) {
      await db.foods.bulkAdd(missing.map((food) => structuredClone(food)));
    }
  });
}

export async function listFoods(query = ''): Promise<Food[]> {
  const needle = query.trim().toLocaleLowerCase('zh-CN');
  return (await db.foods.toArray())
    .filter((food) => food.deletedAt === null)
    .filter(
      (food) =>
        needle.length === 0 ||
        `${food.name} ${food.aliases.join(' ')}`.toLocaleLowerCase('zh-CN').includes(needle),
    )
    .sort((left, right) => {
      if (left.preset && right.preset) {
        return (
          (PRESET_ORDER.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (PRESET_ORDER.get(right.id) ?? Number.MAX_SAFE_INTEGER)
        );
      }
      if (left.preset !== right.preset) return left.preset ? -1 : 1;
      return left.name.localeCompare(right.name, 'zh-CN');
    });
}

export async function getFood(id: string): Promise<Food | undefined> {
  const row = await db.foods.get(id);
  return row?.deletedAt === null ? row : undefined;
}

export async function saveCustomFood(
  operationId: string,
  input: SaveCustomFoodInput,
): Promise<Food> {
  const id = `food:custom:${operationKey(operationId)}`;
  return db.transaction('rw', db.foods, async () => {
    const candidate = buildCustomFood(id, input, Date.now());
    assertFoodSnapshot(candidate);
    const existing = await db.foods.get(id);
    if (existing !== undefined) {
      if (
        existing.preset ||
        stableJson(semanticFood(existing)) !== stableJson(semanticFood(candidate))
      ) {
        throw new Error('operation id conflict');
      }
      if (existing.deletedAt === null) return existing;
      await db.foods.put(candidate);
      return candidate;
    }

    await db.foods.add(candidate);
    return candidate;
  });
}

export async function removeCustomFood(id: string): Promise<void> {
  await db.transaction('rw', db.foods, async () => {
    const existing = await db.foods.get(id);
    if (existing === undefined) return;
    if (existing.preset) throw new Error('preset foods cannot be removed');
    if (existing.deletedAt !== null) return;
    const now = Date.now();
    const tombstone = { ...existing, updatedAt: now, deletedAt: now };
    assertFoodSnapshot(tombstone);
    await db.foods.put(tombstone);
  });
}
