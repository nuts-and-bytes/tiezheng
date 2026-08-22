import { PHOTO_AI_VERSIONS } from './photoAiContract';
import { TEXT_AI_VERSIONS } from './textAiContract';
import {
  FOOD_SNAPSHOT_LIMITS,
  assertBoundedText,
  assertFiniteRange,
  assertNutrientSnapshot,
  assertSafeTimestamp,
} from './foodSnapshotValidation';
import type { MealEstimateCandidate, MealItem } from './nutritionTypes';

export interface ConfirmedModelRangeCandidate {
  candidate: MealEstimateCandidate;
  confirmedAmount: number;
  confirmedUnit: 'g' | 'mL';
  confirmedName: string;
  confirmedPreparation: string;
  confirmedAssumptions: string[];
  confirmedEnergyKcal?: number;
  confirmedProteinG?: number;
}

export interface ModelRangeSourcePolicy {
  source: 'photo-ai-user-confirmed' | 'text-ai-user-confirmed';
  sourceVersion: string;
  uncertaintyModelVersion: string;
  allowEditedNutrients: boolean;
  rangePolicy: 'scale-by-confirmed-amount' | 'preserve-returned-range';
}

interface ModelRangeItemIds {
  id: string;
  mealId: string;
  order: number;
  now: number;
}

interface NutrientRange {
  energyKcalLow: number;
  energyKcalHigh: number;
  proteinGLow: number;
  proteinGHigh: number;
}

const INPUT_REQUIRED_KEYS = [
  'candidate',
  'confirmedAmount',
  'confirmedUnit',
  'confirmedName',
  'confirmedPreparation',
  'confirmedAssumptions',
] as const;
const INPUT_OPTIONAL_KEYS = [
  'confirmedEnergyKcal',
  'confirmedProteinG',
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
const IDS_KEYS = ['id', 'mealId', 'order', 'now'] as const;
const POLICY_KEYS = [
  'source',
  'sourceVersion',
  'uncertaintyModelVersion',
  'allowEditedNutrients',
  'rangePolicy',
] as const;
const UNCERTAINTY_ASSUMPTION = '估算不确定性较高';
const EDITED_MIDPOINT_ASSUMPTION = '用户修改了 AI 中点估算';
const PHOTO_SOURCE_VERSION = [
  PHOTO_AI_VERSIONS.model,
  PHOTO_AI_VERSIONS.prompt,
  PHOTO_AI_VERSIONS.schema,
  PHOTO_AI_VERSIONS.uncertainty,
].join('/');
const TEXT_SOURCE_VERSION = [
  TEXT_AI_VERSIONS.model,
  TEXT_AI_VERSIONS.prompt,
  TEXT_AI_VERSIONS.schema,
  TEXT_AI_VERSIONS.uncertainty,
].join('/');

export const TEXT_MODEL_POLICY: ModelRangeSourcePolicy = Object.freeze({
  source: 'text-ai-user-confirmed',
  sourceVersion: TEXT_SOURCE_VERSION,
  uncertaintyModelVersion: TEXT_AI_VERSIONS.uncertainty,
  allowEditedNutrients: true,
  rangePolicy: 'preserve-returned-range',
});

function invalid(label: string): never {
  throw new Error(`${label} fields are invalid`);
}

function snapshotObject(value: unknown, label: string): ReadonlyMap<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return invalid(label);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalid(label);

    const snapshot = new Map<string, unknown>();
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return invalid(label);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
        return invalid(label);
      }
      snapshot.set(key, descriptor.value);
    }
    return snapshot;
  } catch {
    return invalid(label);
  }
}

function hasExactKeys(
  snapshot: ReadonlyMap<string, unknown>,
  keys: readonly string[],
): boolean {
  return snapshot.size === keys.length && keys.every((key) => snapshot.has(key));
}

function snapshotStrings(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
  label: string,
): string[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return invalid(label);
    }
    const properties = new Map<string, unknown>();
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return invalid(label);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
        return invalid(label);
      }
      properties.set(key, descriptor.value);
    }
    const length = properties.get('length');
    if (
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > maximumItems ||
      properties.size !== length + 1
    ) {
      return invalid(label);
    }

    const result: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      if (!properties.has(key)) return invalid(label);
      const entry = properties.get(key);
      assertBoundedText(entry, `${label}[${index}]`, maximumLength);
      result.push(entry);
    }
    return result;
  } catch {
    return invalid(label);
  }
}

function assertNonNegativeRangeValue(
  value: unknown,
  field: string,
  maximum: number,
): asserts value is number {
  assertFiniteRange(value, field, 0, maximum);
  if (Object.is(value, -0)) throw new Error(`${field} must not be negative zero`);
}

function snapshotCandidate(value: unknown): MealEstimateCandidate & NutrientRange {
  const fields = snapshotObject(value, 'model-range candidate');
  if (!hasExactKeys(fields, CANDIDATE_KEYS)) return invalid('model-range candidate');

  const id = fields.get('id');
  const name = fields.get('name');
  const preparation = fields.get('preparation');
  const amountLow = fields.get('amountLow');
  const amountHigh = fields.get('amountHigh');
  const unit = fields.get('unit');
  const catalogFoodId = fields.get('catalogFoodId');
  const nutrientSource = fields.get('nutrientSource');
  const energyKcalLow = fields.get('energyKcalLow');
  const energyKcalHigh = fields.get('energyKcalHigh');
  const proteinGLow = fields.get('proteinGLow');
  const proteinGHigh = fields.get('proteinGHigh');

  assertBoundedText(id, 'model-range candidate id', 120);
  assertBoundedText(name, 'model-range candidate name', 120);
  assertBoundedText(preparation, 'model-range candidate preparation', 120);
  assertFiniteRange(amountLow, 'model-range candidate amountLow', 0.01, 100_000);
  assertFiniteRange(amountHigh, 'model-range candidate amountHigh', 0.01, 100_000);
  if (amountLow > amountHigh) throw new Error('model-range candidate amount range is invalid');
  if (unit !== 'g' && unit !== 'mL') throw new Error('model-range candidate unit is invalid');
  if (catalogFoodId !== null) throw new Error('model-range candidate catalogFoodId must be null');
  if (nutrientSource !== 'model-range') {
    throw new Error('model-range candidate nutrientSource is invalid');
  }
  assertNonNegativeRangeValue(
    energyKcalLow,
    'model-range candidate energyKcalLow',
    FOOD_SNAPSHOT_LIMITS.energyKcal,
  );
  assertNonNegativeRangeValue(
    energyKcalHigh,
    'model-range candidate energyKcalHigh',
    FOOD_SNAPSHOT_LIMITS.energyKcal,
  );
  assertNonNegativeRangeValue(
    proteinGLow,
    'model-range candidate proteinGLow',
    FOOD_SNAPSHOT_LIMITS.proteinG,
  );
  assertNonNegativeRangeValue(
    proteinGHigh,
    'model-range candidate proteinGHigh',
    FOOD_SNAPSHOT_LIMITS.proteinG,
  );
  if (energyKcalLow > energyKcalHigh || proteinGLow > proteinGHigh) {
    throw new Error('model-range candidate nutrient ranges are invalid');
  }
  const assumptions = snapshotStrings(fields.get('assumptions'), 12, 240, 'model-range assumptions');
  if (assumptions.length === 0) throw new Error('model-range candidate assumptions are required');

  return {
    id,
    name,
    preparation,
    amountLow,
    amountHigh,
    unit,
    catalogFoodId: null,
    nutrientSource: 'model-range',
    energyKcalLow,
    energyKcalHigh,
    proteinGLow,
    proteinGHigh,
    assumptions,
  };
}

function snapshotIds(value: unknown): ModelRangeItemIds {
  const fields = snapshotObject(value, 'model-range item ids');
  if (!hasExactKeys(fields, IDS_KEYS)) return invalid('model-range item ids');
  const id = fields.get('id');
  const mealId = fields.get('mealId');
  const order = fields.get('order');
  const now = fields.get('now');
  assertBoundedText(id, 'model-range item id', FOOD_SNAPSHOT_LIMITS.id);
  assertBoundedText(mealId, 'model-range item mealId', FOOD_SNAPSHOT_LIMITS.id);
  if (typeof order !== 'number' || !Number.isInteger(order) || order < 0 || order > 10_000) {
    throw new Error('model-range item order is invalid');
  }
  assertSafeTimestamp(now, 'model-range item timestamp');
  return { id, mealId, order, now };
}

function snapshotPolicy(value: unknown): 'photo' | 'text' {
  const fields = snapshotObject(value, 'model-range policy');
  if (!hasExactKeys(fields, POLICY_KEYS)) return invalid('model-range policy');

  const source = fields.get('source');
  const sourceVersion = fields.get('sourceVersion');
  const uncertaintyModelVersion = fields.get('uncertaintyModelVersion');
  const allowEditedNutrients = fields.get('allowEditedNutrients');
  const rangePolicy = fields.get('rangePolicy');
  if (
    source === 'photo-ai-user-confirmed' &&
    sourceVersion === PHOTO_SOURCE_VERSION &&
    uncertaintyModelVersion === PHOTO_AI_VERSIONS.uncertainty &&
    allowEditedNutrients === false &&
    rangePolicy === 'scale-by-confirmed-amount'
  ) {
    return 'photo';
  }
  if (
    source === 'text-ai-user-confirmed' &&
    sourceVersion === TEXT_SOURCE_VERSION &&
    uncertaintyModelVersion === TEXT_AI_VERSIONS.uncertainty &&
    allowEditedNutrients === true &&
    rangePolicy === 'preserve-returned-range'
  ) {
    return 'text';
  }
  throw new Error('model-range policy is not an approved combination');
}

function midpointInteger(low: number, high: number): number {
  return Math.round((low + high) / 2);
}

function midpointTenth(low: number, high: number): number {
  return Math.round(((low + high) / 2 + Number.EPSILON) * 10) / 10;
}

function midpointExact(low: number, high: number): number {
  return (low + high) / 2;
}

function preservePositiveUnderflow(
  value: number,
  factors: readonly number[],
): number {
  return value === 0 && factors.every((factor) => factor > 0)
    ? Number.MIN_VALUE
    : value;
}

function isReservedAssumption(assumption: string): boolean {
  const comparable = assumption.normalize('NFC').trim();
  return (
    comparable === UNCERTAINTY_ASSUMPTION ||
    comparable === EDITED_MIDPOINT_ASSUMPTION
  );
}

function assertOutputRange(range: NutrientRange): void {
  assertNonNegativeRangeValue(
    range.energyKcalLow,
    'model-range item energyKcalLow',
    FOOD_SNAPSHOT_LIMITS.energyKcal,
  );
  assertNonNegativeRangeValue(
    range.energyKcalHigh,
    'model-range item energyKcalHigh',
    FOOD_SNAPSHOT_LIMITS.energyKcal,
  );
  assertNonNegativeRangeValue(
    range.proteinGLow,
    'model-range item proteinGLow',
    FOOD_SNAPSHOT_LIMITS.proteinG,
  );
  assertNonNegativeRangeValue(
    range.proteinGHigh,
    'model-range item proteinGHigh',
    FOOD_SNAPSHOT_LIMITS.proteinG,
  );
  if (range.energyKcalLow > range.energyKcalHigh || range.proteinGLow > range.proteinGHigh) {
    throw new Error('model-range item nutrient ranges are invalid');
  }
}

function manualEntry(reason: string): never {
  throw new Error(`manual-entry-required: ${reason}`);
}

export function buildModelRangeMealItem(
  input: ConfirmedModelRangeCandidate,
  ids: ModelRangeItemIds,
  policy: ModelRangeSourcePolicy,
): MealItem {
  const policyKind = snapshotPolicy(policy);
  const fields = snapshotObject(input, 'confirmed model-range candidate');
  const allowedInputKeys = [...INPUT_REQUIRED_KEYS, ...INPUT_OPTIONAL_KEYS];
  if (
    !INPUT_REQUIRED_KEYS.every((key) => fields.has(key)) ||
    fields.size < INPUT_REQUIRED_KEYS.length ||
    fields.size > allowedInputKeys.length ||
    [...fields.keys()].some((key) => !allowedInputKeys.includes(key as typeof allowedInputKeys[number]))
  ) {
    return invalid('confirmed model-range candidate');
  }
  const hasEnergyPoint = fields.has('confirmedEnergyKcal');
  const hasProteinPoint = fields.has('confirmedProteinG');
  if (policyKind === 'photo' && (hasEnergyPoint || hasProteinPoint)) {
    throw new Error('photo model-range policy does not allow edited nutrients');
  }

  const candidate = snapshotCandidate(fields.get('candidate'));
  const confirmedAmount = fields.get('confirmedAmount');
  const confirmedUnit = fields.get('confirmedUnit');
  const confirmedName = fields.get('confirmedName');
  const confirmedPreparation = fields.get('confirmedPreparation');
  assertFiniteRange(confirmedAmount, 'confirmed amount', 0.01, 100_000);
  if (confirmedUnit !== 'g' && confirmedUnit !== 'mL') {
    throw new Error('confirmed unit is invalid');
  }
  if (confirmedUnit !== candidate.unit) {
    manualEntry('model-range unit conversion is unavailable');
  }
  assertBoundedText(confirmedName, 'confirmed name', 120);
  assertBoundedText(confirmedPreparation, 'confirmed preparation', 120, true);
  const confirmedAssumptions = snapshotStrings(
    fields.get('confirmedAssumptions'),
    29,
    FOOD_SNAPSHOT_LIMITS.text,
    'confirmed assumptions',
  );
  const identity = snapshotIds(ids);

  let range: NutrientRange;
  if (policyKind === 'photo') {
    const scaledEnergyHigh =
      (candidate.energyKcalHigh * confirmedAmount) / candidate.amountLow;
    const scaledProteinHighTenths =
      (candidate.proteinGHigh * confirmedAmount * 10) / candidate.amountLow;
    range = {
      energyKcalLow: Math.max(
        0,
        Math.floor((candidate.energyKcalLow * confirmedAmount) / candidate.amountHigh),
      ),
      energyKcalHigh: Math.ceil(
        preservePositiveUnderflow(scaledEnergyHigh, [
          candidate.energyKcalHigh,
          confirmedAmount,
          candidate.amountLow,
        ]),
      ),
      proteinGLow:
        Math.max(
          0,
          Math.floor((candidate.proteinGLow * confirmedAmount * 10) / candidate.amountHigh),
        ) / 10,
      proteinGHigh:
        Math.ceil(
          preservePositiveUnderflow(scaledProteinHighTenths, [
            candidate.proteinGHigh,
            confirmedAmount,
            candidate.amountLow,
            10,
          ]),
        ) / 10,
    };
  } else {
    range = {
      energyKcalLow: candidate.energyKcalLow,
      energyKcalHigh: candidate.energyKcalHigh,
      proteinGLow: candidate.proteinGLow,
      proteinGHigh: candidate.proteinGHigh,
    };
  }
  assertOutputRange(range);

  let pointEnergy = policyKind === 'photo'
    ? midpointInteger(range.energyKcalLow, range.energyKcalHigh)
    : midpointExact(range.energyKcalLow, range.energyKcalHigh);
  let pointProtein = policyKind === 'photo'
    ? midpointTenth(range.proteinGLow, range.proteinGHigh)
    : midpointExact(range.proteinGLow, range.proteinGHigh);
  let editedOutsideRange = false;
  if (policyKind === 'text' && hasEnergyPoint) {
    const editedEnergy = fields.get('confirmedEnergyKcal');
    assertNonNegativeRangeValue(
      editedEnergy,
      'confirmed energyKcal',
      FOOD_SNAPSHOT_LIMITS.energyKcal,
    );
    editedOutsideRange = editedEnergy < range.energyKcalLow || editedEnergy > range.energyKcalHigh;
    range = {
      ...range,
      energyKcalLow: Math.min(range.energyKcalLow, editedEnergy),
      energyKcalHigh: Math.max(range.energyKcalHigh, editedEnergy),
    };
    pointEnergy = editedEnergy;
  }
  if (policyKind === 'text' && hasProteinPoint) {
    const editedProtein = fields.get('confirmedProteinG');
    assertNonNegativeRangeValue(
      editedProtein,
      'confirmed proteinG',
      FOOD_SNAPSHOT_LIMITS.proteinG,
    );
    editedOutsideRange =
      editedOutsideRange ||
      editedProtein < range.proteinGLow ||
      editedProtein > range.proteinGHigh;
    range = {
      ...range,
      proteinGLow: Math.min(range.proteinGLow, editedProtein),
      proteinGHigh: Math.max(range.proteinGHigh, editedProtein),
    };
    pointProtein = editedProtein;
  }
  assertOutputRange(range);

  const outputAssumptions = confirmedAssumptions.filter(
    (assumption) => !isReservedAssumption(assumption),
  );
  if (editedOutsideRange) {
    outputAssumptions.push(EDITED_MIDPOINT_ASSUMPTION);
  }
  if (outputAssumptions.length > FOOD_SNAPSHOT_LIMITS.arrayItems - 1) {
    throw new Error('confirmed assumptions leave no room for the uncertainty marker');
  }

  const row: MealItem = {
    id: identity.id,
    mealId: identity.mealId,
    order: identity.order,
    confirmedAt: identity.now,
    updatedAt: identity.now,
    deletedAt: null,
    name: confirmedName,
    preparation: confirmedPreparation,
    amount: confirmedAmount,
    unit: confirmedUnit,
    method: 'ai-confirmed',
    quality: 'B',
    originalEnergyValue: pointEnergy,
    originalEnergyUnit: 'kcal',
    originalProteinG: pointProtein,
    originalBasisAmount: confirmedAmount,
    originalBasisUnit: confirmedUnit,
    basisAmount: confirmedAmount,
    basisUnit: confirmedUnit,
    ediblePortionRatio: 1,
    densityGPerMl: null,
    conversionAssumptions: [],
    fdcId: null,
    fdcDataType: null,
    sourceRetrievedAt: null,
    source: policyKind === 'photo' ? 'photo-ai-user-confirmed' : 'text-ai-user-confirmed',
    sourceVersion: policyKind === 'photo' ? PHOTO_SOURCE_VERSION : TEXT_SOURCE_VERSION,
    license: 'model-estimate-user-confirmed',
    energyKcal: pointEnergy,
    proteinG: pointProtein,
    ...range,
    assumptions: [UNCERTAINTY_ASSUMPTION, ...outputAssumptions],
    uncertaintyModelVersion:
      policyKind === 'photo' ? PHOTO_AI_VERSIONS.uncertainty : TEXT_AI_VERSIONS.uncertainty,
  };
  assertNutrientSnapshot(row, 'confirmed model-range item');
  return row;
}
