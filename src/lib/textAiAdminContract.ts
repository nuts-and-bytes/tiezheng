export const TEXT_AI_ADMIN_SCHEMA_VERSION = 1 as const;

export type TextAiAdminOperation =
  | 'status'
  | 'probe-deepseek-connectivity'
  | 'enable-text-global'
  | 'disable-text-global'
  | 'enable-account'
  | 'disable-account'
  | 'delete-account';

export type TextAiAdminTarget = 'user-1' | 'user-2';

export interface TextAiAdminRequest {
  schemaVersion: 1;
  operationId: string;
  operation: TextAiAdminOperation;
  target: TextAiAdminTarget;
}

export interface TextAiAdminWorkerRequest {
  schemaVersion: 1;
  operationId: string;
  operation: TextAiAdminOperation;
  accountKey: string;
}

export interface TextAiAdminStatus {
  textGlobalEnabled: boolean;
  accountEnabled: boolean;
  accountRemaining: number;
  globalRemaining: number;
  budgetSpentMicros: number;
  budgetReservedMicros: number;
  resetAt: string;
}

export type TextAiConnectivityResult =
  | 'http-2xx'
  | 'http-3xx'
  | 'http-4xx'
  | 'http-5xx'
  | 'http-other'
  | 'timeout'
  | 'fetch-rejected';

export type TextAiAdminResponse =
  | { ok: true; operationId: string; status: TextAiAdminStatus }
  | { ok: true; operationId: string; connectivity: TextAiConnectivityResult }
  | {
    ok: false;
    code:
      | 'auth-required'
      | 'invalid-request'
      | 'operation-conflict'
      | 'service-disabled';
  };

type PropertySnapshot = ReadonlyMap<string, unknown>;
type TextAiAdminFailureCode = Extract<
  TextAiAdminResponse,
  { ok: false }
>['code'];

const INVALID_CONTRACT = 'Invalid text admin contract';
const OPERATION_ID_PATTERN = /^[0-9a-f]{32}$/;
const ACCOUNT_KEY_PATTERN = /^[0-9a-f]{64}$/;

function invalidContract(): never {
  throw new Error(INVALID_CONTRACT);
}

function snapshotObject(value: unknown): PropertySnapshot {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return invalidContract();
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidContract();
    }

    const snapshot = new Map<string, unknown>();
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return invalidContract();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ) {
        return invalidContract();
      }
      snapshot.set(key, descriptor.value);
    }
    return snapshot;
  } catch {
    return invalidContract();
  }
}

function hasExactKeys(
  snapshot: PropertySnapshot,
  keys: readonly string[],
): boolean {
  return (
    snapshot.size === keys.length && keys.every((key) => snapshot.has(key))
  );
}

function isOperation(value: unknown): value is TextAiAdminOperation {
  return (
    value === 'status' ||
    value === 'probe-deepseek-connectivity' ||
    value === 'enable-text-global' ||
    value === 'disable-text-global' ||
    value === 'enable-account' ||
    value === 'disable-account' ||
    value === 'delete-account'
  );
}

function isConnectivityResult(value: unknown): value is TextAiConnectivityResult {
  return (
    value === 'http-2xx' ||
    value === 'http-3xx' ||
    value === 'http-4xx' ||
    value === 'http-5xx' ||
    value === 'http-other' ||
    value === 'timeout' ||
    value === 'fetch-rejected'
  );
}

function isOperationId(value: unknown): value is string {
  return typeof value === 'string' && OPERATION_ID_PATTERN.test(value);
}

function isAccountKey(value: unknown): value is string {
  return typeof value === 'string' && ACCOUNT_KEY_PATTERN.test(value);
}

function isTarget(value: unknown): value is TextAiAdminTarget {
  return value === 'user-1' || value === 'user-2';
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    !Object.is(value, -0)
  );
}

function isIntegerInRange(
  value: unknown,
  maximum: number,
): value is number {
  return isNonNegativeInteger(value) && value <= maximum;
}

function isCanonicalUtcInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new Date(value);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
  } catch {
    return false;
  }
}

function isFailureCode(value: unknown): value is TextAiAdminFailureCode {
  return (
    value === 'auth-required' ||
    value === 'invalid-request' ||
    value === 'operation-conflict' ||
    value === 'service-disabled'
  );
}

export function parseTextAiAdminRequest(
  value: unknown,
): TextAiAdminRequest {
  const snapshot = snapshotObject(value);
  if (
    !hasExactKeys(snapshot, [
      'schemaVersion',
      'operationId',
      'operation',
      'target',
    ])
  ) {
    return invalidContract();
  }

  const schemaVersion = snapshot.get('schemaVersion');
  const operationId = snapshot.get('operationId');
  const operation = snapshot.get('operation');
  const target = snapshot.get('target');
  if (
    schemaVersion !== TEXT_AI_ADMIN_SCHEMA_VERSION ||
    !isOperationId(operationId) ||
    !isOperation(operation) ||
    !isTarget(target)
  ) {
    return invalidContract();
  }

  return {
    schemaVersion: TEXT_AI_ADMIN_SCHEMA_VERSION,
    operationId,
    operation,
    target,
  };
}

export function parseTextAiAdminWorkerRequest(
  value: unknown,
): TextAiAdminWorkerRequest {
  const snapshot = snapshotObject(value);
  if (
    !hasExactKeys(snapshot, [
      'schemaVersion',
      'operationId',
      'operation',
      'accountKey',
    ])
  ) {
    return invalidContract();
  }

  const schemaVersion = snapshot.get('schemaVersion');
  const operationId = snapshot.get('operationId');
  const operation = snapshot.get('operation');
  const accountKey = snapshot.get('accountKey');
  if (
    schemaVersion !== TEXT_AI_ADMIN_SCHEMA_VERSION ||
    !isOperationId(operationId) ||
    !isOperation(operation) ||
    !isAccountKey(accountKey)
  ) {
    return invalidContract();
  }

  return {
    schemaVersion: TEXT_AI_ADMIN_SCHEMA_VERSION,
    operationId,
    operation,
    accountKey,
  };
}

function parseStatus(value: unknown): TextAiAdminStatus {
  const snapshot = snapshotObject(value);
  if (
    !hasExactKeys(snapshot, [
      'textGlobalEnabled',
      'accountEnabled',
      'accountRemaining',
      'globalRemaining',
      'budgetSpentMicros',
      'budgetReservedMicros',
      'resetAt',
    ])
  ) {
    return invalidContract();
  }

  const textGlobalEnabled = snapshot.get('textGlobalEnabled');
  const accountEnabled = snapshot.get('accountEnabled');
  const accountRemaining = snapshot.get('accountRemaining');
  const globalRemaining = snapshot.get('globalRemaining');
  const budgetSpentMicros = snapshot.get('budgetSpentMicros');
  const budgetReservedMicros = snapshot.get('budgetReservedMicros');
  const resetAt = snapshot.get('resetAt');
  if (
    typeof textGlobalEnabled !== 'boolean' ||
    typeof accountEnabled !== 'boolean' ||
    !isIntegerInRange(accountRemaining, 10) ||
    !isIntegerInRange(globalRemaining, 30) ||
    !isNonNegativeInteger(budgetSpentMicros) ||
    !isNonNegativeInteger(budgetReservedMicros) ||
    !isCanonicalUtcInstant(resetAt)
  ) {
    return invalidContract();
  }

  return {
    textGlobalEnabled,
    accountEnabled,
    accountRemaining,
    globalRemaining,
    budgetSpentMicros,
    budgetReservedMicros,
    resetAt,
  };
}

export function parseTextAiAdminResponse(
  value: unknown,
): TextAiAdminResponse {
  const snapshot = snapshotObject(value);
  const ok = snapshot.get('ok');

  if (ok === false) {
    if (!hasExactKeys(snapshot, ['ok', 'code'])) return invalidContract();
    const code = snapshot.get('code');
    if (!isFailureCode(code)) return invalidContract();
    return { ok: false, code };
  }

  if (ok === true) {
    const operationId = snapshot.get('operationId');
    if (!isOperationId(operationId)) return invalidContract();
    if (hasExactKeys(snapshot, ['ok', 'operationId', 'connectivity'])) {
      const connectivity = snapshot.get('connectivity');
      if (!isConnectivityResult(connectivity)) return invalidContract();
      return { ok: true, operationId, connectivity };
    }
    if (!hasExactKeys(snapshot, ['ok', 'operationId', 'status'])) {
      return invalidContract();
    }
    return {
      ok: true,
      operationId,
      status: parseStatus(snapshot.get('status')),
    };
  }

  return invalidContract();
}
