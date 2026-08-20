import { PRESET_FOODS } from '../../../src/data/presetFoods';
import * as candidatePolicy from '../../../src/lib/photoAiCandidate';
import type { MealEstimateCandidate } from '../../../src/lib/nutritionTypes';

const INVALID_MODEL_OUTPUT = 'Invalid model output';
const CANDIDATE_FIELDS = [
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

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(Reflect.get(value, key) as unknown);
  }
  return Object.freeze(value);
}

const nullableEnergy = { type: ['number', 'null'], minimum: 0, maximum: 100_000 } as const;
const nullableProtein = { type: ['number', 'null'], minimum: 0, maximum: 10_000 } as const;

export const DOUBAO_ESTIMATE_JSON_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [...CANDIDATE_FIELDS],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 120 },
          preparation: { type: 'string', minLength: 1, maxLength: 120 },
          amountLow: { type: 'number', exclusiveMinimum: 0, maximum: 100_000 },
          amountHigh: { type: 'number', exclusiveMinimum: 0, maximum: 100_000 },
          unit: { type: 'string', enum: ['g', 'mL'] },
          catalogFoodId: { type: ['string', 'null'], maxLength: 120 },
          nutrientSource: { type: 'string', enum: ['catalog', 'model-range', 'none'] },
          energyKcalLow: nullableEnergy,
          energyKcalHigh: nullableEnergy,
          proteinGLow: nullableProtein,
          proteinGHigh: nullableProtein,
          assumptions: {
            type: 'array',
            maxItems: 12,
            items: { type: 'string', minLength: 1, maxLength: 240 },
          },
        },
      },
    },
  },
} as const);

type Snapshot = ReadonlyMap<string, unknown>;

function invalid(): never {
  throw new TypeError(INVALID_MODEL_OUTPUT);
}

function snapshotObject(value: unknown, keys: readonly string[]): Snapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return invalid();
  const result = new Map<string, unknown>();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) return invalid();
    result.set(key, descriptor.value);
  }
  return result;
}

function snapshotArray(value: unknown, maximum: number, minimum = 0): unknown[] {
  if (!Array.isArray(value)
    || value.length < minimum
    || value.length > maximum
    || Object.getPrototypeOf(value) !== Array.prototype) return invalid();
  const allowed = new Set(['length', ...Array.from({ length: value.length }, (_, index) => String(index))]);
  if (Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !allowed.has(key))) return invalid();
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !('value' in descriptor)) return invalid();
    result.push(descriptor.value);
  }
  return result;
}

function text(value: unknown, maximum: number, allowBlank = false): string {
  if (typeof value !== 'string' || value.length > maximum || (!allowBlank && value.trim().length === 0)) return invalid();
  if (/[\u0000-\u001f\u007f]/.test(value)) return invalid();
  return value;
}

function finite(value: unknown, maximum: number, allowZero = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value > maximum || (allowZero ? value < 0 : value <= 0)) return invalid();
  return value;
}

function nullableFinite(value: unknown, maximum: number): number | null {
  if (value === null) return null;
  return finite(value, maximum, true);
}

function assumptions(value: unknown): string[] {
  return snapshotArray(value, 12).map((entry) => text(entry, 240));
}

function allNull(values: readonly (number | null)[]): boolean {
  return values.every((value) => value === null);
}

function allNumbers(values: readonly (number | null)[]): boolean {
  return values.every((value) => value !== null);
}

function completeRanges(
  values: readonly [number | null, number | null, number | null, number | null],
): [number, number, number, number] {
  if (!allNumbers(values)) return invalid();
  return [values[0]!, values[1]!, values[2]!, values[3]!];
}

const catalog = new Map(PRESET_FOODS.map((food) => [food.id, food] as const));

interface RawCandidateSnapshot {
  name: string;
  preparation: string;
  amountLow: number;
  amountHigh: number;
  unit: 'g' | 'mL';
  catalogFoodId: string | null;
  nutrientSource: 'catalog' | 'model-range' | 'none';
  energyKcalLow: number | null;
  energyKcalHigh: number | null;
  proteinGLow: number | null;
  proteinGHigh: number | null;
  assumptions: string[];
}

export interface ValidatedDoubaoEstimate {
  candidates: RawCandidateSnapshot[];
}

function snapshotCandidate(value: unknown): RawCandidateSnapshot {
  const row = snapshotObject(value, CANDIDATE_FIELDS);
  const name = text(row.get('name'), 120);
  const preparation = text(row.get('preparation'), 120);
  const amountLow = finite(row.get('amountLow'), 100_000);
  const amountHigh = finite(row.get('amountHigh'), 100_000);
  if (amountLow > amountHigh) return invalid();
  const unit = row.get('unit');
  if (unit !== 'g' && unit !== 'mL') return invalid();
  const catalogFoodIdValue = row.get('catalogFoodId');
  const catalogFoodId = catalogFoodIdValue === null ? null : text(catalogFoodIdValue, 120);
  const nutrientSource = row.get('nutrientSource');
  if (nutrientSource !== 'catalog' && nutrientSource !== 'model-range' && nutrientSource !== 'none') return invalid();
  const ranges = [
    nullableFinite(row.get('energyKcalLow'), 100_000),
    nullableFinite(row.get('energyKcalHigh'), 100_000),
    nullableFinite(row.get('proteinGLow'), 10_000),
    nullableFinite(row.get('proteinGHigh'), 10_000),
  ] as const;
  const notes = assumptions(row.get('assumptions'));

  if (nutrientSource === 'catalog') {
    if (catalogFoodId === null || (!allNull(ranges) && !allNumbers(ranges))) return invalid();
    const food = catalog.get(catalogFoodId);
    if (food === undefined || food.deletedAt !== null) return invalid();
  }

  if (nutrientSource === 'none') {
    if (catalogFoodId !== null || !allNull(ranges) || notes.length !== 0) return invalid();
  } else if (nutrientSource === 'model-range') {
    if (catalogFoodId !== null || notes.length === 0) return invalid();
    const [energyKcalLow, energyKcalHigh, proteinGLow, proteinGHigh] = completeRanges(ranges);
    if (energyKcalLow > energyKcalHigh || proteinGLow > proteinGHigh) return invalid();
  }

  return {
    name,
    preparation,
    amountLow,
    amountHigh,
    unit,
    catalogFoodId,
    nutrientSource,
    energyKcalLow: ranges[0],
    energyKcalHigh: ranges[1],
    proteinGLow: ranges[2],
    proteinGHigh: ranges[3],
    assumptions: [...notes],
  };
}

function duplicateKey(row: RawCandidateSnapshot): string {
  if (row.catalogFoodId !== null) return `catalog:${row.catalogFoodId}`;
  return `model:${row.name.trim().toLocaleLowerCase('zh-CN')}|${row.preparation.trim().toLocaleLowerCase('zh-CN')}|${row.unit}`;
}

export function validateDoubaoEstimate(value: unknown): ValidatedDoubaoEstimate {
  try {
    const parsed = typeof value === 'string'
      ? (value.length > 100_000 ? invalid() : JSON.parse(value) as unknown)
      : value;
    const root = snapshotObject(parsed, ['candidates']);
    const rows = snapshotArray(root.get('candidates'), 6, 1).map(snapshotCandidate);
    const seen = new Set<string>();
    for (const row of rows) {
      const key = duplicateKey(row);
      if (seen.has(key)) return invalid();
      seen.add(key);
    }
    return { candidates: rows };
  } catch {
    return invalid();
  }
}

function mapCandidate(row: RawCandidateSnapshot, index: number): MealEstimateCandidate {
  const common = {
    id: `candidate-${index + 1}`,
    preparation: row.preparation,
    amountLow: row.amountLow,
    amountHigh: row.amountHigh,
    unit: row.unit,
  } as const;

  if (row.nutrientSource === 'catalog') {
    const food = catalog.get(row.catalogFoodId!);
    if (food === undefined || food.deletedAt !== null) return invalid();
    return {
      ...common,
      name: food.name,
      catalogFoodId: food.id,
      nutrientSource: 'catalog',
      energyKcalLow: null,
      energyKcalHigh: null,
      proteinGLow: null,
      proteinGHigh: null,
      assumptions: [...row.assumptions],
    };
  }

  if (row.nutrientSource === 'none') {
    return {
      ...common,
      name: row.name,
      catalogFoodId: null,
      nutrientSource: 'none',
      energyKcalLow: null,
      energyKcalHigh: null,
      proteinGLow: null,
      proteinGHigh: null,
      assumptions: [],
    };
  }

  const widened = candidatePolicy.applyPhotoUncertaintyV1({
    energyKcalLow: row.energyKcalLow!,
    energyKcalHigh: row.energyKcalHigh!,
    proteinGLow: row.proteinGLow!,
    proteinGHigh: row.proteinGHigh!,
  });
  return {
    ...common,
    name: row.name,
    catalogFoodId: null,
    nutrientSource: 'model-range',
    ...widened,
    assumptions: [...row.assumptions],
  };
}

export function parseDoubaoEstimate(value: unknown): MealEstimateCandidate[] {
  try {
    return validateDoubaoEstimate(value).candidates.map(mapCandidate);
  } catch {
    return invalid();
  }
}
