import { PHOTO_AI_VERSIONS } from './photoAiContract';
import {
  FOOD_SNAPSHOT_LIMITS,
  assertBoundedText,
  assertFiniteRange,
  assertFoodSnapshot,
  assertNutrientSnapshot,
  assertSafeTimestamp,
} from './foodSnapshotValidation';
import type { Food, MealEstimateCandidate, MealItem } from './nutritionTypes';

export interface ConfirmedPhotoCandidate {
  candidate: MealEstimateCandidate;
  confirmedAmount: number;
  confirmedUnit: 'g' | 'mL';
  confirmedName: string;
  confirmedPreparation: string;
  confirmedAssumptions: string[];
}

export interface RawModelNutrientRange {
  energyKcalLow: number;
  energyKcalHigh: number;
  proteinGLow: number;
  proteinGHigh: number;
}

const RANGE_KEYS = [
  'energyKcalLow',
  'energyKcalHigh',
  'proteinGLow',
  'proteinGHigh',
] as const;
const CANDIDATE_KEYS = [
  'id',
  'name',
  'preparation',
  'amountLow',
  'amountHigh',
  'unit',
  'catalogFoodId',
  'nutrientSource',
  'energyKcalLow',
  'energyKcalHigh',
  'proteinGLow',
  'proteinGHigh',
  'assumptions',
] as const;
const FOOD_KEYS = [
  'id',
  'name',
  'aliases',
  'rawOrCooked',
  'preparation',
  'originalEnergyValue',
  'originalEnergyUnit',
  'originalProteinG',
  'originalBasisAmount',
  'originalBasisUnit',
  'basisAmount',
  'basisUnit',
  'energyKcal',
  'proteinG',
  'ediblePortionRatio',
  'densityGPerMl',
  'conversionAssumptions',
  'fdcId',
  'fdcDataType',
  'sourceRetrievedAt',
  'source',
  'sourceVersion',
  'license',
  'preset',
  'updatedAt',
  'deletedAt',
] as const;
const MODEL_SOURCE_VERSION = [
  PHOTO_AI_VERSIONS.model,
  PHOTO_AI_VERSIONS.prompt,
  PHOTO_AI_VERSIONS.schema,
  PHOTO_AI_VERSIONS.uncertainty,
].join('/');

function snapshotObject(
  value: unknown,
  keys: readonly string[],
  label: string,
): ReadonlyMap<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`${label} must be an object`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${label} has an invalid prototype`);
    }
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      throw new Error(`${label} fields are invalid`);
    }
    const snapshot = new Map<string, unknown>();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new Error(`${label} fields are invalid`);
      }
      snapshot.set(key, descriptor.value);
    }
    return snapshot;
  } catch {
    throw new Error(`${label} fields are invalid`);
  }
}

function snapshotStrings(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
  label: string,
  allowBlank = false,
): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Error(`${label} is invalid`);
  }
  const result: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new Error(`${label} is invalid`);
    }
    const entry = descriptor.value;
    if (
      typeof entry !== 'string' ||
      (!allowBlank && entry.trim().length === 0) ||
      entry.length > maximumLength
    ) {
      throw new Error(`${label} is invalid`);
    }
    result.push(entry);
  }
  return result;
}

function snapshotCatalogFood(value: Food): Food {
  const fields = snapshotObject(value, FOOD_KEYS, 'catalog food');
  const aliases = snapshotStrings(
    fields.get('aliases'),
    FOOD_SNAPSHOT_LIMITS.arrayItems,
    FOOD_SNAPSHOT_LIMITS.text,
    'catalog food aliases',
    true,
  );
  const conversionAssumptions = snapshotStrings(
    fields.get('conversionAssumptions'),
    FOOD_SNAPSHOT_LIMITS.arrayItems,
    FOOD_SNAPSHOT_LIMITS.text,
    'catalog food conversionAssumptions',
    true,
  );
  const snapshot = Object.fromEntries(fields) as unknown as Food;
  snapshot.aliases = aliases;
  snapshot.conversionAssumptions = conversionAssumptions;
  assertFoodSnapshot(snapshot);
  return snapshot;
}

function positiveRangeValue(value: unknown, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new Error(`${label} must be finite, positive and bounded`);
  }
  return value;
}

function snapshotRawRange(value: RawModelNutrientRange): RawModelNutrientRange {
  const snapshot = snapshotObject(value, RANGE_KEYS, 'photo nutrient range');
  const energyKcalLow = positiveRangeValue(
    snapshot.get('energyKcalLow'),
    FOOD_SNAPSHOT_LIMITS.energyKcal,
    'energyKcalLow',
  );
  const energyKcalHigh = positiveRangeValue(
    snapshot.get('energyKcalHigh'),
    FOOD_SNAPSHOT_LIMITS.energyKcal,
    'energyKcalHigh',
  );
  const proteinGLow = positiveRangeValue(
    snapshot.get('proteinGLow'),
    FOOD_SNAPSHOT_LIMITS.proteinG,
    'proteinGLow',
  );
  const proteinGHigh = positiveRangeValue(
    snapshot.get('proteinGHigh'),
    FOOD_SNAPSHOT_LIMITS.proteinG,
    'proteinGHigh',
  );
  if (energyKcalLow > energyKcalHigh || proteinGLow > proteinGHigh) {
    throw new Error('photo nutrient ranges must be ascending');
  }
  return { energyKcalLow, energyKcalHigh, proteinGLow, proteinGHigh };
}

function assertOutputRange(range: RawModelNutrientRange): void {
  assertFiniteRange(range.energyKcalLow, 'photo energyKcalLow', 0, FOOD_SNAPSHOT_LIMITS.energyKcal);
  assertFiniteRange(range.energyKcalHigh, 'photo energyKcalHigh', 0, FOOD_SNAPSHOT_LIMITS.energyKcal);
  assertFiniteRange(range.proteinGLow, 'photo proteinGLow', 0, FOOD_SNAPSHOT_LIMITS.proteinG);
  assertFiniteRange(range.proteinGHigh, 'photo proteinGHigh', 0, FOOD_SNAPSHOT_LIMITS.proteinG);
  if (range.energyKcalLow > range.energyKcalHigh || range.proteinGLow > range.proteinGHigh) {
    throw new Error('photo nutrient ranges must be ascending');
  }
}

export function applyPhotoUncertaintyV1(
  raw: RawModelNutrientRange,
): RawModelNutrientRange {
  const snapshot = snapshotRawRange(raw);
  const widened = {
    energyKcalLow: Math.max(0, Math.floor(snapshot.energyKcalLow * 0.8)),
    energyKcalHigh: Math.ceil(snapshot.energyKcalHigh * 1.2),
    proteinGLow: Math.max(0, Math.floor(snapshot.proteinGLow * 0.8 * 10) / 10),
    proteinGHigh: Math.ceil(snapshot.proteinGHigh * 1.2 * 10) / 10,
  };
  assertOutputRange(widened);
  return widened;
}

function snapshotCandidate(candidate: MealEstimateCandidate): {
  id: string;
  name: string;
  preparation: string;
  amountLow: number;
  amountHigh: number;
  unit: 'g' | 'mL';
  catalogFoodId: string | null;
  nutrientSource: MealEstimateCandidate['nutrientSource'];
  energyKcalLow: unknown;
  energyKcalHigh: unknown;
  proteinGLow: unknown;
  proteinGHigh: unknown;
  assumptions: string[];
} {
  const snapshot = snapshotObject(candidate, CANDIDATE_KEYS, 'photo candidate');
  const id = snapshot.get('id');
  const name = snapshot.get('name');
  const preparation = snapshot.get('preparation');
  const amountLow = snapshot.get('amountLow');
  const amountHigh = snapshot.get('amountHigh');
  const unit = snapshot.get('unit');
  const catalogFoodId = snapshot.get('catalogFoodId');
  const nutrientSource = snapshot.get('nutrientSource');
  assertBoundedText(id, 'photo candidate id', 120);
  assertBoundedText(name, 'photo candidate name', 120);
  assertBoundedText(preparation, 'photo candidate preparation', 120);
  assertFiniteRange(amountLow, 'photo candidate amountLow', 0.01, 100_000);
  assertFiniteRange(amountHigh, 'photo candidate amountHigh', 0.01, 100_000);
  if (amountLow > amountHigh) throw new Error('photo candidate amount range must be ascending');
  if (unit !== 'g' && unit !== 'mL') throw new Error('photo candidate unit is invalid');
  if (catalogFoodId !== null) assertBoundedText(catalogFoodId, 'photo catalogFoodId', 120);
  if (
    nutrientSource !== 'catalog' &&
    nutrientSource !== 'model-range' &&
    nutrientSource !== 'none'
  ) {
    throw new Error('photo candidate nutrient source is invalid');
  }
  const assumptions = snapshotStrings(snapshot.get('assumptions'), 12, 240, 'photo assumptions');
  return {
    id,
    name,
    preparation,
    amountLow,
    amountHigh,
    unit,
    catalogFoodId,
    nutrientSource,
    energyKcalLow: snapshot.get('energyKcalLow'),
    energyKcalHigh: snapshot.get('energyKcalHigh'),
    proteinGLow: snapshot.get('proteinGLow'),
    proteinGHigh: snapshot.get('proteinGHigh'),
    assumptions,
  };
}

function manualEntry(reason: string): never {
  throw new Error(`manual-entry-required: ${reason}`);
}

function stable(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 1_000_000_000_000) / 1_000_000_000_000;
  if (!Number.isFinite(rounded)) throw new Error('photo nutrient calculation overflowed');
  return rounded;
}

function midpointInteger(low: number, high: number): number {
  return Math.round((low + high) / 2);
}

function midpointTenth(low: number, high: number): number {
  return Math.round(((low + high) / 2 + Number.EPSILON) * 10) / 10;
}

function baseItem(
  input: ConfirmedPhotoCandidate,
  ids: { id: string; mealId: string; order: number; now: number },
): {
  candidate: ReturnType<typeof snapshotCandidate>;
  confirmedAmount: number;
  confirmedUnit: 'g' | 'mL';
  confirmedName: string;
  confirmedPreparation: string;
  confirmedAssumptions: string[];
  identity: Pick<MealItem, 'id' | 'mealId' | 'order' | 'confirmedAt' | 'updatedAt' | 'deletedAt'>;
} {
  const fields = snapshotObject(
    input,
    [
      'candidate',
      'confirmedAmount',
      'confirmedUnit',
      'confirmedName',
      'confirmedPreparation',
      'confirmedAssumptions',
    ],
    'confirmed photo candidate',
  );
  const candidate = snapshotCandidate(fields.get('candidate') as MealEstimateCandidate);
  const confirmedAmount = fields.get('confirmedAmount');
  const confirmedUnit = fields.get('confirmedUnit');
  const confirmedName = fields.get('confirmedName');
  const confirmedPreparation = fields.get('confirmedPreparation');
  assertFiniteRange(confirmedAmount, 'confirmed amount', 0.01, 100_000);
  if (confirmedUnit !== 'g' && confirmedUnit !== 'mL') throw new Error('confirmed unit is invalid');
  assertBoundedText(confirmedName, 'confirmed name', 120);
  assertBoundedText(confirmedPreparation, 'confirmed preparation', 120, true);
  const confirmedAssumptions = snapshotStrings(
    fields.get('confirmedAssumptions'),
    29,
    FOOD_SNAPSHOT_LIMITS.text,
    'confirmed assumptions',
  );
  const identityFields = snapshotObject(ids, ['id', 'mealId', 'order', 'now'], 'photo item ids');
  const id = identityFields.get('id');
  const mealId = identityFields.get('mealId');
  const order = identityFields.get('order');
  const now = identityFields.get('now');
  assertBoundedText(id, 'photo item id', FOOD_SNAPSHOT_LIMITS.id);
  assertBoundedText(mealId, 'photo item mealId', FOOD_SNAPSHOT_LIMITS.id);
  if (typeof order !== 'number' || !Number.isInteger(order) || order < 0 || order > 10_000) {
    throw new Error('photo item order is invalid');
  }
  assertSafeTimestamp(now, 'photo item timestamp');
  return {
    candidate,
    confirmedAmount,
    confirmedUnit,
    confirmedName,
    confirmedPreparation,
    confirmedAssumptions,
    identity: {
      id,
      mealId,
      order,
      confirmedAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  };
}

export function buildPhotoMealItem(
  input: ConfirmedPhotoCandidate,
  catalogFood: Food | undefined,
  ids: { id: string; mealId: string; order: number; now: number },
): MealItem {
  const snapshot = baseItem(input, ids);
  const common = {
    ...snapshot.identity,
    name: snapshot.confirmedName,
    preparation: snapshot.confirmedPreparation,
    amount: snapshot.confirmedAmount,
    unit: snapshot.confirmedUnit,
    method: 'ai-confirmed' as const,
    quality: 'B' as const,
  };

  if (snapshot.candidate.nutrientSource === 'none') {
    throw new Error('photo candidate has no confirmable nutrition');
  }

  if (snapshot.candidate.nutrientSource === 'catalog') {
    if (catalogFood === undefined) throw new Error('catalog food is required');
    const food = snapshotCatalogFood(catalogFood);
    if (food.deletedAt !== null) throw new Error('catalog food must be active');
    if (snapshot.candidate.catalogFoodId !== food.id) {
      throw new Error('catalog food does not match the candidate');
    }
    let amountInBasisUnit = snapshot.confirmedAmount;
    if (snapshot.confirmedUnit !== food.basisUnit) {
      const density = food.densityGPerMl;
      if (density === null) manualEntry('catalog density is unavailable');
      amountInBasisUnit =
        food.basisUnit === 'g'
          ? snapshot.confirmedAmount * density
          : snapshot.confirmedAmount / density;
    }
    const factor = amountInBasisUnit / food.basisAmount;
    const energy = stable(food.energyKcal * factor);
    const protein = stable(food.proteinG * factor);
    const row: MealItem = {
      ...common,
      originalEnergyValue: food.originalEnergyValue,
      originalEnergyUnit: food.originalEnergyUnit,
      originalProteinG: food.originalProteinG,
      originalBasisAmount: food.originalBasisAmount,
      originalBasisUnit: food.originalBasisUnit,
      basisAmount: food.basisAmount,
      basisUnit: food.basisUnit,
      ediblePortionRatio: food.ediblePortionRatio,
      densityGPerMl: food.densityGPerMl,
      conversionAssumptions: [...food.conversionAssumptions],
      fdcId: food.fdcId,
      fdcDataType: food.fdcDataType,
      sourceRetrievedAt: food.sourceRetrievedAt,
      source: food.source,
      sourceVersion: food.sourceVersion,
      license: food.license,
      energyKcal: food.energyKcal,
      proteinG: food.proteinG,
      energyKcalLow: energy,
      energyKcalHigh: energy,
      proteinGLow: protein,
      proteinGHigh: protein,
      assumptions: [
        `食物目录快照 ${food.id}`,
        ...snapshot.confirmedAssumptions,
      ],
      uncertaintyModelVersion: PHOTO_AI_VERSIONS.uncertainty,
    };
    assertNutrientSnapshot(row, 'photo catalog item');
    assertOutputRange(row);
    return row;
  }

  if (catalogFood !== undefined || snapshot.candidate.catalogFoodId !== null) {
    throw new Error('model-range candidates cannot use a catalog food');
  }
  if (snapshot.confirmedUnit !== snapshot.candidate.unit) {
    manualEntry('model-range unit conversion is unavailable');
  }
  if (snapshot.candidate.assumptions.length === 0) {
    throw new Error('model-range candidate assumptions are required');
  }
  const candidateRange = snapshotRawRange({
    energyKcalLow: snapshot.candidate.energyKcalLow as number,
    energyKcalHigh: snapshot.candidate.energyKcalHigh as number,
    proteinGLow: snapshot.candidate.proteinGLow as number,
    proteinGHigh: snapshot.candidate.proteinGHigh as number,
  });
  const range = {
    energyKcalLow: Math.max(
      0,
      Math.floor(
        (candidateRange.energyKcalLow * snapshot.confirmedAmount) /
          snapshot.candidate.amountHigh,
      ),
    ),
    energyKcalHigh: Math.ceil(
      (candidateRange.energyKcalHigh * snapshot.confirmedAmount) /
        snapshot.candidate.amountLow,
    ),
    proteinGLow:
      Math.max(
        0,
        Math.floor(
          (candidateRange.proteinGLow * snapshot.confirmedAmount * 10) /
            snapshot.candidate.amountHigh,
        ),
      ) / 10,
    proteinGHigh:
      Math.ceil(
        (candidateRange.proteinGHigh * snapshot.confirmedAmount * 10) /
          snapshot.candidate.amountLow,
      ) / 10,
  };
  assertOutputRange(range);
  const pointEnergy = midpointInteger(range.energyKcalLow, range.energyKcalHigh);
  const pointProtein = midpointTenth(range.proteinGLow, range.proteinGHigh);
  const row: MealItem = {
    ...common,
    originalEnergyValue: pointEnergy,
    originalEnergyUnit: 'kcal',
    originalProteinG: pointProtein,
    originalBasisAmount: snapshot.confirmedAmount,
    originalBasisUnit: snapshot.confirmedUnit,
    basisAmount: snapshot.confirmedAmount,
    basisUnit: snapshot.confirmedUnit,
    ediblePortionRatio: 1,
    densityGPerMl: null,
    conversionAssumptions: [],
    fdcId: null,
    fdcDataType: null,
    sourceRetrievedAt: null,
    source: 'photo-ai-user-confirmed',
    sourceVersion: MODEL_SOURCE_VERSION,
    license: 'model-estimate-user-confirmed',
    energyKcal: pointEnergy,
    proteinG: pointProtein,
    ...range,
    assumptions: ['估算不确定性较高', ...snapshot.confirmedAssumptions],
    uncertaintyModelVersion: PHOTO_AI_VERSIONS.uncertainty,
  };
  assertNutrientSnapshot(row, 'photo model item');
  return row;
}
