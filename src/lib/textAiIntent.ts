import {
  TEXT_AI_LIMITS,
  TEXT_AI_VERSIONS,
  parseTextAiEstimateRequest,
  type TextMealDraft,
} from './textAiContract';
import type { MealSlot } from './nutritionTypes';

export interface TextAiIntentDraft extends TextMealDraft {
  date: string;
  slot: MealSlot;
}

export interface TextAiIntent extends TextAiIntentDraft {
  version: 1;
  createdAt: number;
  expiresAt: number;
}

export const TEXT_AI_LOGIN_PATH = '/api/nutrition/text/session?resume=1';

const STORAGE_KEY = 'tiezheng:text-ai-intent:v1';
const DRAFT_KEYS = ['date', 'slot', 'description', 'amount'] as const;
const INTENT_KEYS = [
  'version',
  'date',
  'slot',
  'description',
  'amount',
  'createdAt',
  'expiresAt',
] as const;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLOTS = new Set<MealSlot>(['breakfast', 'lunch', 'dinner', 'snack']);
const VALIDATION_REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const VALIDATION_IDEMPOTENCY_KEY = VALIDATION_REQUEST_ID.replaceAll('-', '');
let storageUnavailable = false;

function invalidIntent(): never {
  throw new TypeError('Invalid text AI intent');
}

function isSafeTimestamp(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    !Object.is(value, -0) &&
    value >= 0
  );
}

function assertNow(value: number): void {
  if (!isSafeTimestamp(value)) invalidIntent();
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isSlot(value: unknown): value is MealSlot {
  return typeof value === 'string' && SLOTS.has(value as MealSlot);
}

function exactDataFields(
  value: unknown,
  keys: readonly string[],
): Map<string, unknown> | undefined {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return undefined;
    }
    const fields = new Map<string, unknown>();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
        return undefined;
      }
      fields.set(key, descriptor.value);
    }
    return fields;
  } catch {
    return undefined;
  }
}

function parseDraftFields(fields: Map<string, unknown>): TextAiIntentDraft | undefined {
  const date = fields.get('date');
  const slot = fields.get('slot');
  if (!isDateKey(date) || !isSlot(slot)) return undefined;
  try {
    const parsed = parseTextAiEstimateRequest({
      requestId: VALIDATION_REQUEST_ID,
      idempotencyKey: VALIDATION_IDEMPOTENCY_KEY,
      description: fields.get('description'),
      amount: fields.get('amount'),
      modelVersion: TEXT_AI_VERSIONS.model,
      promptVersion: TEXT_AI_VERSIONS.prompt,
      schemaVersion: TEXT_AI_VERSIONS.schema,
      catalogVersion: TEXT_AI_VERSIONS.catalog,
      uncertaintyVersion: TEXT_AI_VERSIONS.uncertainty,
      providerPolicyVersion: TEXT_AI_VERSIONS.providerPolicy,
      locale: 'zh-CN',
    });
    return {
      date,
      slot,
      description: parsed.description,
      amount: structuredClone(parsed.amount),
    };
  } catch {
    return undefined;
  }
}

function snapshotDraft(value: unknown): TextAiIntentDraft | undefined {
  const fields = exactDataFields(value, DRAFT_KEYS);
  return fields === undefined ? undefined : parseDraftFields(fields);
}

function snapshotIntent(value: unknown): TextAiIntent | undefined {
  const fields = exactDataFields(value, INTENT_KEYS);
  if (fields === undefined) return undefined;
  const version = fields.get('version');
  const createdAt = fields.get('createdAt');
  const expiresAt = fields.get('expiresAt');
  if (
    version !== 1 ||
    !isSafeTimestamp(createdAt) ||
    !isSafeTimestamp(expiresAt) ||
    expiresAt !== createdAt + TEXT_AI_LIMITS.intentMs
  ) {
    return undefined;
  }
  const draft = parseDraftFields(fields);
  if (
    draft === undefined ||
    draft.description !== fields.get('description')
  ) {
    return undefined;
  }
  return {
    version,
    ...draft,
    createdAt,
    expiresAt,
  };
}

function storage(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    storageUnavailable = true;
    return undefined;
  }
}

export function saveTextAiIntent(
  value: TextAiIntentDraft,
  now = Date.now(),
): void {
  assertNow(now);
  const draft = snapshotDraft(value);
  if (draft === undefined) invalidIntent();
  const expiresAt = now + TEXT_AI_LIMITS.intentMs;
  if (!isSafeTimestamp(expiresAt)) invalidIntent();

  const intent: TextAiIntent = {
    version: 1,
    ...draft,
    createdAt: now,
    expiresAt,
  };
  const target = storage();
  if (target === undefined) invalidIntent();
  try {
    target.removeItem(STORAGE_KEY);
  } catch {
    storageUnavailable = true;
    try {
      target.setItem(STORAGE_KEY, '');
    } catch {
      // The login navigation is stopped by the error below.
    }
    return invalidIntent();
  }
  try {
    target.setItem(STORAGE_KEY, JSON.stringify(intent));
    storageUnavailable = false;
  } catch {
    storageUnavailable = true;
    try {
      target.removeItem(STORAGE_KEY);
    } catch {
      try {
        target.setItem(STORAGE_KEY, '');
      } catch {
        // The latch keeps this page fail closed until storage recovers.
      }
    }
    return invalidIntent();
  }
}

export function clearTextAiIntent(): void {
  const target = storage();
  if (target === undefined) return;
  try {
    target.removeItem(STORAGE_KEY);
    storageUnavailable = false;
  } catch {
    storageUnavailable = true;
    try {
      target.setItem(STORAGE_KEY, '');
    } catch {
      // Fail closed when session storage is unavailable.
    }
  }
}

export function takeTextAiIntent(now = Date.now()): TextAiIntent | undefined {
  assertNow(now);
  let raw: string | null;
  try {
    const target = storage();
    if (target === undefined) return undefined;
    if (storageUnavailable) {
      try {
        target.removeItem(STORAGE_KEY);
        storageUnavailable = false;
      } catch {
        try {
          target.setItem(STORAGE_KEY, '');
        } catch {
          // Keep the latch set until a later storage operation succeeds.
        }
      }
      return undefined;
    }
    raw = target.getItem(STORAGE_KEY);
    try {
      target.removeItem(STORAGE_KEY);
    } catch {
      storageUnavailable = true;
      try {
        target.setItem(STORAGE_KEY, '');
      } catch {
        // The latch prevents replay in this page.
      }
      return undefined;
    }
  } catch {
    storageUnavailable = true;
    return undefined;
  }
  if (raw === null) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  const intent = snapshotIntent(parsed);
  if (
    intent === undefined ||
    now < intent.createdAt ||
    now >= intent.expiresAt
  ) {
    return undefined;
  }
  return intent;
}
