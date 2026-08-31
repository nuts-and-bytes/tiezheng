import {
  TEXT_AI_LIMITS,
} from '../../../src/lib/textAiContract';
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

export type DoubaoTextOutput =
  | { status: 'complete'; candidate: Omit<MealEstimateCandidate, 'id'> }
  | { status: 'uncertain'; candidate: null };

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && Object.hasOwn(descriptor, 'value')) {
      deepFreeze(descriptor.value as unknown);
    }
  }
  return Object.freeze(value);
}

const COMPLETE_CANDIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...CANDIDATE_FIELDS],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 },
    preparation: { type: 'string', minLength: 1, maxLength: 120 },
    amountLow: { type: 'number', minimum: TEXT_AI_LIMITS.amountMin, maximum: TEXT_AI_LIMITS.amountMax },
    amountHigh: { type: 'number', minimum: TEXT_AI_LIMITS.amountMin, maximum: TEXT_AI_LIMITS.amountMax },
    unit: { type: 'string', enum: ['g', 'mL'] },
    catalogFoodId: { type: 'null' },
    nutrientSource: { type: 'string', enum: ['model-range'] },
    energyKcalLow: { type: 'number', minimum: 0, maximum: 100_000 },
    energyKcalHigh: { type: 'number', minimum: 0, maximum: 100_000 },
    proteinGLow: { type: 'number', minimum: 0, maximum: 10_000 },
    proteinGHigh: { type: 'number', minimum: 0, maximum: 10_000 },
    assumptions: {
      type: 'array',
      minItems: 1,
      maxItems: TEXT_AI_LIMITS.assumptions,
      items: { type: 'string', minLength: 1, maxLength: 240 },
    },
  },
} as const;

export const DOUBAO_TEXT_JSON_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['status', 'candidate'],
  properties: {
    status: { type: 'string', enum: ['complete', 'uncertain'] },
    candidate: {
      anyOf: [
        COMPLETE_CANDIDATE_SCHEMA,
        { type: 'null' },
      ],
    },
  },
} as const);

type Snapshot = ReadonlyMap<string, unknown>;

function invalid(): never {
  throw new TypeError(INVALID_MODEL_OUTPUT);
}

function snapshotObject(value: unknown, expectedKeys: readonly string[]): Snapshot {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalid();

    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== expectedKeys.length ||
      ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return invalid();
    }

    const snapshot = new Map<string, unknown>();
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return invalid();
      snapshot.set(key, descriptor.value);
    }
    return snapshot;
  } catch {
    return invalid();
  }
}

function snapshotArray(value: unknown, minimum: number, maximum: number): unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return invalid();
    const ownKeys = Reflect.ownKeys(value);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (
      lengthDescriptor === undefined ||
      !Object.hasOwn(lengthDescriptor, 'value') ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      Object.is(lengthDescriptor.value, -0) ||
      lengthDescriptor.value < minimum ||
      lengthDescriptor.value > maximum ||
      ownKeys.length !== lengthDescriptor.value + 1
    ) {
      return invalid();
    }

    const snapshot: unknown[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return invalid();
      snapshot.push(descriptor.value);
    }
    return snapshot;
  } catch {
    return invalid();
  }
}

const UNSAFE_DISPLAY_CHARACTERS = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

function safeText(value: unknown, maximumLength: number): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximumLength ||
    value.trim().length < 1 ||
    UNSAFE_DISPLAY_CHARACTERS.test(value)
  ) {
    return invalid();
  }
  return value;
}

function finite(value: unknown, minimum: number, maximum: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Object.is(value, -0) ||
    value < minimum ||
    value > maximum
  ) {
    return invalid();
  }
  return value;
}

function snapshotCandidate(value: unknown): Omit<MealEstimateCandidate, 'id'> {
  const snapshot = snapshotObject(value, CANDIDATE_FIELDS);
  const name = safeText(snapshot.get('name'), 120);
  const preparation = safeText(snapshot.get('preparation'), 120);
  const amountLow = finite(snapshot.get('amountLow'), TEXT_AI_LIMITS.amountMin, TEXT_AI_LIMITS.amountMax);
  const amountHigh = finite(snapshot.get('amountHigh'), TEXT_AI_LIMITS.amountMin, TEXT_AI_LIMITS.amountMax);
  const unit = snapshot.get('unit');
  const energyKcalLow = finite(snapshot.get('energyKcalLow'), 0, 100_000);
  const energyKcalHigh = finite(snapshot.get('energyKcalHigh'), 0, 100_000);
  const proteinGLow = finite(snapshot.get('proteinGLow'), 0, 10_000);
  const proteinGHigh = finite(snapshot.get('proteinGHigh'), 0, 10_000);
  const assumptions = snapshotArray(
    snapshot.get('assumptions'),
    1,
    TEXT_AI_LIMITS.assumptions,
  ).map((entry) => safeText(entry, 240));

  if (
    amountLow > amountHigh ||
    energyKcalLow > energyKcalHigh ||
    proteinGLow > proteinGHigh ||
    (unit !== 'g' && unit !== 'mL') ||
    snapshot.get('catalogFoodId') !== null ||
    snapshot.get('nutrientSource') !== 'model-range'
  ) {
    return invalid();
  }

  return {
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
    assumptions: [...assumptions],
  };
}

export function parseDoubaoTextEstimate(value: unknown): DoubaoTextOutput {
  try {
    const root = snapshotObject(value, ['status', 'candidate']);
    const status = root.get('status');
    if (status === 'uncertain') {
      if (root.get('candidate') !== null) return invalid();
      return { status: 'uncertain', candidate: null };
    }
    if (status !== 'complete') return invalid();
    return {
      status: 'complete',
      candidate: snapshotCandidate(root.get('candidate')),
    };
  } catch {
    return invalid();
  }
}
