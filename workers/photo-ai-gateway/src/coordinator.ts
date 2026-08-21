import { DurableObject } from 'cloudflare:workers';

import type { GatewayEnv } from './env';

export const GATEWAY_LIMITS = Object.freeze({
  accountDaily: 10,
  accountPerMinute: 2,
  accountConcurrent: 1,
  betaAccounts: 3,
  globalDaily: 30,
  globalConcurrent: 2,
  monthlyBudgetMicros: 50_000_000,
  initialAttemptReserveMicros: 2_000_000,
  retryAttemptReserveMicros: 2_000_000,
  leaseMs: 60_000,
  resultCacheMs: 10 * 60_000,
  idempotencyMs: 24 * 60 * 60_000,
  providerTimeoutMs: 12_000,
  maxInputTokens: 256_000,
  maxOutputTokens: 1_500,
  maxMultipartBytes: 1_100_000,
  maxDecodedPixels: 40_000_000,
  maxDimension: 12_000,
  maxAspectRatio: 20,
} as const);

const INVALID_INPUT = 'Invalid coordinator input';
const OPERATION_REJECTED = 'Coordinator operation rejected';
const GLOBAL_SCOPE = '$global';
const MAX_DATE_MS = 8_640_000_000_000_000;
const MAX_DERIVED_DATE_WINDOW_MS = 32 * 86_400_000 + 8 * 60 * 60_000;

export interface StatusInput {
  accountKey: string;
  now: number;
}

export interface CoordinatorStatus {
  enabled: boolean;
  accountEnabled: boolean;
  accountRemaining: number;
  globalRemaining: number;
  accountConcurrent: number;
  globalConcurrent: number;
  budgetSpentMicros: number;
  budgetReservedMicros: number;
  resetAt: string;
}

export interface ReserveInput {
  accountKey: string;
  idempotencyKey: string;
  fingerprint: string;
  now: number;
  reserveMicros: number;
}

export interface EncryptedCandidateCache {
  ivBase64: string;
  ciphertextBase64: string;
  expiresAt: number;
}

export type CoordinatorFailureCode =
  | 'provider-timeout'
  | 'provider-unavailable'
  | 'invalid-estimate';

export type ReserveResult =
  | { kind: 'reserved'; leaseId: string }
  | { kind: 'cached'; cache: EncryptedCandidateCache }
  | { kind: 'in-flight'; retryAfterMs: number }
  | { kind: 'failed'; code: CoordinatorFailureCode }
  | {
      kind: 'rejected';
      code: 'service-disabled' | 'quota-exceeded' | 'rate-limited' | 'budget-exceeded' | 'idempotency-conflict';
      retryAt: string | null;
      resetAt: string | null;
    };

export interface LeaseInput {
  accountKey: string;
  idempotencyKey: string;
  fingerprint: string;
  leaseId: string;
  now: number;
}

export interface SettleSuccessInput extends LeaseInput {
  cache: EncryptedCandidateCache;
  actualCostMicros: number;
}

export interface SettleFailureInput extends LeaseInput {
  actualCostMicros: number | null;
  errorCode: CoordinatorFailureCode;
}

type RejectionCode = Extract<ReserveResult, { kind: 'rejected' }>['code'];

interface CounterRow {
  pending: number;
  consumed: number;
}

interface CountRow {
  count: number;
}

interface SettingRow {
  value: number;
}

interface IdempotencyRow {
  fingerprint: string;
  state: string;
  lease_id: string | null;
  cache_iv: string | null;
  cache_ciphertext: string | null;
  cache_expires_at: number | null;
  error_code: string | null;
  expires_at: number;
}

interface LeaseRow {
  lease_id: string;
  account_key: string;
  idempotency_key: string;
  fingerprint: string;
  day_bucket: string;
  month_bucket: string;
  initial_reserve_micros: number;
  retry_reserve_micros: number;
  invoked: number;
  expires_at: number;
}

function invalid(): never {
  throw new TypeError(INVALID_INPUT);
}

function rejectedOperation(): never {
  throw new TypeError(OPERATION_REJECTED);
}

function safeTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value)
    || (value as number) < 0
    || (value as number) > MAX_DATE_MS - MAX_DERIVED_DATE_WINDOW_MS) return invalid();
  return value as number;
}

function safeMicros(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > GATEWAY_LIMITS.monthlyBudgetMicros) return invalid();
  return value as number;
}

export function arkCostMicros(inputTokens: number, outputTokens: number): number {
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0
    || !Number.isSafeInteger(outputTokens) || outputTokens < 0) return invalid();
  const result = inputTokens * 6 + outputTokens * 30;
  if (!Number.isSafeInteger(result)) return invalid();
  return result;
}

function accountKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return invalid();
  return value;
}

function idempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) return invalid();
  return value;
}

function fingerprint(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return invalid();
  return value;
}

function leaseId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) return invalid();
  return value;
}

function shanghaiParts(now: number): { year: number; month: number; day: number } {
  const shifted = new Date(now + 8 * 60 * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

function dayBucket(now: number): string {
  const parts = shanghaiParts(now);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function monthBucket(now: number): string {
  const parts = shanghaiParts(now);
  return `${parts.year}-${pad(parts.month)}`;
}

function nextDay(now: number): string {
  const parts = shanghaiParts(now);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1) - 8 * 60 * 60_000).toISOString();
}

function nextMonth(now: number): string {
  const parts = shanghaiParts(now);
  return new Date(Date.UTC(parts.year, parts.month, 1) - 8 * 60 * 60_000).toISOString();
}

function nextMinute(now: number): string {
  return new Date((Math.floor(now / 60_000) + 1) * 60_000).toISOString();
}

function minuteBucket(now: number): string {
  return Math.floor(now / 60_000).toString();
}

function retryAfter(now: number, until: number): number {
  return Math.max(0, Math.min(GATEWAY_LIMITS.idempotencyMs, until - now));
}

function failureCode(value: unknown): CoordinatorFailureCode {
  if (value !== 'provider-timeout'
    && value !== 'provider-unavailable'
    && value !== 'invalid-estimate') return invalid();
  return value;
}

function reserveRejection(
  code: RejectionCode,
  retryAt: string | null = null,
  resetAt: string | null = null,
): ReserveResult {
  return { kind: 'rejected', code, retryAt, resetAt };
}

function cacheValue(value: EncryptedCandidateCache, now: number): EncryptedCandidateCache {
  if (typeof value !== 'object' || value === null) return invalid();
  const ivBase64 = value.ivBase64;
  const ciphertextBase64 = value.ciphertextBase64;
  const expiresAt = safeTimestamp(value.expiresAt);
  const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  if (typeof ivBase64 !== 'string' || ivBase64.length < 4 || ivBase64.length > 256 || !base64.test(ivBase64)
    || typeof ciphertextBase64 !== 'string' || ciphertextBase64.length < 4 || ciphertextBase64.length > 400_000 || !base64.test(ciphertextBase64)
    || expiresAt <= now || expiresAt > now + GATEWAY_LIMITS.resultCacheMs) return invalid();
  return { ivBase64, ciphertextBase64, expiresAt };
}

function leaseInput(value: LeaseInput): LeaseInput {
  return {
    accountKey: accountKey(value.accountKey),
    idempotencyKey: idempotencyKey(value.idempotencyKey),
    fingerprint: fingerprint(value.fingerprint),
    leaseId: leaseId(value.leaseId),
    now: safeTimestamp(value.now),
  };
}

export class PhotoAiCoordinator extends DurableObject<GatewayEnv> {
  constructor(ctx: DurableObjectState, env: GatewayEnv) {
    super(ctx, env);
    this.ctx.storage.transactionSync(() => {
      this.exec(`CREATE TABLE IF NOT EXISTS idempotency (
        account_key TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        state TEXT NOT NULL,
        lease_id TEXT,
        cache_iv TEXT,
        cache_ciphertext TEXT,
        cache_expires_at INTEGER,
        error_code TEXT,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (account_key, idempotency_key)
      )`);
      this.exec(`CREATE TABLE IF NOT EXISTS daily_counters (
        scope TEXT NOT NULL,
        bucket TEXT NOT NULL,
        pending INTEGER NOT NULL,
        consumed INTEGER NOT NULL,
        PRIMARY KEY (scope, bucket)
      )`);
      this.exec(`CREATE TABLE IF NOT EXISTS minute_counters (
        account_key TEXT NOT NULL,
        bucket TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        PRIMARY KEY (account_key, bucket)
      )`);
      this.exec(`CREATE TABLE IF NOT EXISTS active_leases (
        lease_id TEXT PRIMARY KEY,
        account_key TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        day_bucket TEXT NOT NULL,
        month_bucket TEXT NOT NULL,
        initial_reserve_micros INTEGER NOT NULL,
        retry_reserve_micros INTEGER NOT NULL,
        invoked INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`);
      this.exec(`CREATE TABLE IF NOT EXISTS account_flags (
        account_key TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL
      )`);
      this.exec(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      )`);
      this.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('global_enabled', 0)");
    });
  }

  private exec(query: string, ...bindings: SqlStorageValue[]): void {
    this.ctx.storage.sql.exec(query, ...bindings).toArray();
  }

  private rows<T extends { [K in keyof T]: SqlStorageValue }>(query: string, ...bindings: SqlStorageValue[]): T[] {
    return this.ctx.storage.sql.exec<T>(query, ...bindings).toArray();
  }

  private setting(key: string): number {
    return this.rows<SettingRow>('SELECT value FROM settings WHERE key = ?', key)[0]?.value ?? 0;
  }

  private setSetting(key: string, value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) return rejectedOperation();
    this.exec(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      value,
    );
  }

  private counter(scope: string, bucket: string): CounterRow {
    return this.rows<CounterRow>(
      'SELECT pending, consumed FROM daily_counters WHERE scope = ? AND bucket = ?',
      scope,
      bucket,
    )[0] ?? { pending: 0, consumed: 0 };
  }

  private changeDaily(scope: string, bucket: string, pending: number, consumed: number): void {
    this.exec(
      `INSERT INTO daily_counters (scope, bucket, pending, consumed) VALUES (?, ?, ?, ?)
       ON CONFLICT(scope, bucket) DO UPDATE SET
         pending = daily_counters.pending + excluded.pending,
         consumed = daily_counters.consumed + excluded.consumed`,
      scope,
      bucket,
      pending,
      consumed,
    );
  }

  private cost(month: string): { spent: number; reserved: number } {
    return {
      spent: this.setting(`spent:${month}`),
      reserved: this.setting(`reserved:${month}`),
    };
  }

  private budgetLimit(): number | null {
    const configured = Number(this.env.PHOTO_AI_MONTHLY_BUDGET_MICROS);
    if (!Number.isSafeInteger(configured)
      || configured <= 0
      || configured > GATEWAY_LIMITS.monthlyBudgetMicros) return null;
    return configured;
  }

  private changeCost(month: string, spentDelta: number, reservedDelta: number): void {
    const current = this.cost(month);
    this.setSetting(`spent:${month}`, current.spent + spentDelta);
    this.setSetting(`reserved:${month}`, current.reserved + reservedDelta);
  }

  private activeCount(now: number, account: string | null = null): number {
    const row = account === null
      ? this.rows<CountRow>('SELECT COUNT(*) AS count FROM active_leases WHERE expires_at > ?', now)[0]
      : this.rows<CountRow>(
        'SELECT COUNT(*) AS count FROM active_leases WHERE account_key = ? AND expires_at > ?',
        account,
        now,
      )[0];
    return row?.count ?? 0;
  }

  private getLease(value: LeaseInput): LeaseRow {
    const row = this.rows<LeaseRow>(
      `SELECT lease_id, account_key, idempotency_key, fingerprint, day_bucket, month_bucket,
              initial_reserve_micros, retry_reserve_micros, invoked, expires_at
       FROM active_leases WHERE lease_id = ?`,
      value.leaseId,
    )[0];
    if (row === undefined
      || row.account_key !== value.accountKey
      || row.idempotency_key !== value.idempotencyKey
      || row.fingerprint !== value.fingerprint) return rejectedOperation();
    return row;
  }

  private releaseExpiredLease(row: LeaseRow): void {
    const totalReserve = row.initial_reserve_micros + row.retry_reserve_micros;
    if (row.invoked === 0) {
      this.changeDaily(row.account_key, row.day_bucket, -1, 0);
      this.changeDaily(GLOBAL_SCOPE, row.day_bucket, -1, 0);
      this.changeCost(row.month_bucket, 0, -totalReserve);
    } else {
      this.changeCost(row.month_bucket, totalReserve, -totalReserve);
    }
    this.exec('DELETE FROM active_leases WHERE lease_id = ?', row.lease_id);
    if (row.invoked === 0) {
      this.exec(
        `DELETE FROM idempotency
         WHERE account_key = ? AND idempotency_key = ? AND lease_id = ?`,
        row.account_key,
        row.idempotency_key,
        row.lease_id,
      );
    } else {
      this.exec(
        `UPDATE idempotency SET state = 'failed', lease_id = NULL, error_code = 'provider-timeout'
         WHERE account_key = ? AND idempotency_key = ? AND lease_id = ?`,
        row.account_key,
        row.idempotency_key,
        row.lease_id,
      );
    }
  }

  private cleanup(now: number): void {
    const expired = this.rows<LeaseRow>(
      `SELECT lease_id, account_key, idempotency_key, fingerprint, day_bucket, month_bucket,
              initial_reserve_micros, retry_reserve_micros, invoked, expires_at
       FROM active_leases WHERE expires_at <= ? ORDER BY lease_id`,
      now,
    );
    for (const row of expired) this.releaseExpiredLease(row);
    this.exec(
      `UPDATE idempotency SET cache_iv = NULL, cache_ciphertext = NULL, cache_expires_at = NULL
       WHERE cache_expires_at IS NOT NULL AND cache_expires_at <= ?`,
      now,
    );
    this.exec('DELETE FROM idempotency WHERE expires_at <= ?', now);
  }

  async status(input: StatusInput): Promise<CoordinatorStatus> {
    const account = accountKey(input.accountKey);
    const now = safeTimestamp(input.now);
    return this.ctx.storage.transactionSync(() => {
      this.cleanup(now);
      const day = dayBucket(now);
      const month = monthBucket(now);
      const accountCounter = this.counter(account, day);
      const globalCounter = this.counter(GLOBAL_SCOPE, day);
      const accountEnabled = this.rows<{ enabled: number }>(
        'SELECT enabled FROM account_flags WHERE account_key = ?',
        account,
      )[0]?.enabled === 1;
      const cost = this.cost(month);
      return {
        enabled: this.setting('global_enabled') === 1,
        accountEnabled,
        accountRemaining: Math.max(0, GATEWAY_LIMITS.accountDaily - accountCounter.pending - accountCounter.consumed),
        globalRemaining: Math.max(0, GATEWAY_LIMITS.globalDaily - globalCounter.pending - globalCounter.consumed),
        accountConcurrent: this.activeCount(now, account),
        globalConcurrent: this.activeCount(now),
        budgetSpentMicros: cost.spent,
        budgetReservedMicros: cost.reserved,
        resetAt: nextDay(now),
      };
    });
  }

  async reserve(input: ReserveInput): Promise<ReserveResult> {
    const account = accountKey(input.accountKey);
    const idem = idempotencyKey(input.idempotencyKey);
    const requestFingerprint = fingerprint(input.fingerprint);
    const now = safeTimestamp(input.now);
    const reserveMicros = safeMicros(input.reserveMicros);
    if (reserveMicros < GATEWAY_LIMITS.initialAttemptReserveMicros) return invalid();

    return this.ctx.storage.transactionSync(() => {
      this.cleanup(now);
      const enabled = this.setting('global_enabled') === 1;
      const accountEnabled = this.rows<{ enabled: number }>(
        'SELECT enabled FROM account_flags WHERE account_key = ?',
        account,
      )[0]?.enabled === 1;
      if (!enabled || !accountEnabled) return reserveRejection('service-disabled');

      const existing = this.rows<IdempotencyRow>(
        `SELECT fingerprint, state, lease_id, cache_iv, cache_ciphertext, cache_expires_at,
                error_code, expires_at
         FROM idempotency WHERE account_key = ? AND idempotency_key = ?`,
        account,
        idem,
      )[0];
      if (existing !== undefined) {
        if (existing.fingerprint !== requestFingerprint) return reserveRejection('idempotency-conflict');
        if (existing.state === 'succeeded'
          && existing.cache_iv !== null
          && existing.cache_ciphertext !== null
          && existing.cache_expires_at !== null
          && existing.cache_expires_at > now) {
          return {
            kind: 'cached',
            cache: {
              ivBase64: existing.cache_iv,
              ciphertextBase64: existing.cache_ciphertext,
              expiresAt: existing.cache_expires_at,
            },
          };
        }
        if (existing.state === 'failed') {
          return { kind: 'failed', code: failureCode(existing.error_code) };
        }
        if (existing.state === 'succeeded') {
          return reserveRejection(
            'idempotency-conflict',
            null,
            new Date(existing.expires_at).toISOString(),
          );
        }
        const active = existing.lease_id === null
          ? undefined
          : this.rows<{ expires_at: number }>('SELECT expires_at FROM active_leases WHERE lease_id = ?', existing.lease_id)[0];
        if ((existing.state === 'reserved' || existing.state === 'invoked') && active !== undefined) {
          return { kind: 'in-flight', retryAfterMs: retryAfter(now, active.expires_at) };
        }
        return reserveRejection(
          'idempotency-conflict',
          null,
          new Date(existing.expires_at).toISOString(),
        );
      }

      const minute = minuteBucket(now);
      const attempts = this.rows<{ attempts: number }>(
        'SELECT attempts FROM minute_counters WHERE account_key = ? AND bucket = ?',
        account,
        minute,
      )[0]?.attempts ?? 0;
      if (attempts >= GATEWAY_LIMITS.accountPerMinute) {
        return reserveRejection('rate-limited', nextMinute(now));
      }
      this.exec(
        `INSERT INTO minute_counters (account_key, bucket, attempts) VALUES (?, ?, 1)
         ON CONFLICT(account_key, bucket) DO UPDATE SET attempts = minute_counters.attempts + 1`,
        account,
        minute,
      );

      const day = dayBucket(now);
      const accountCounter = this.counter(account, day);
      const globalCounter = this.counter(GLOBAL_SCOPE, day);
      if (accountCounter.pending + accountCounter.consumed >= GATEWAY_LIMITS.accountDaily
        || globalCounter.pending + globalCounter.consumed >= GATEWAY_LIMITS.globalDaily) {
        return reserveRejection('quota-exceeded', null, nextDay(now));
      }
      if (this.activeCount(now, account) >= GATEWAY_LIMITS.accountConcurrent) {
        const earliest = this.rows<{ expires_at: number }>(
          'SELECT MIN(expires_at) AS expires_at FROM active_leases WHERE account_key = ? AND expires_at > ?',
          account,
          now,
        )[0]?.expires_at;
        return reserveRejection('rate-limited', earliest === undefined ? null : new Date(earliest).toISOString());
      }
      if (this.activeCount(now) >= GATEWAY_LIMITS.globalConcurrent) {
        const earliest = this.rows<{ expires_at: number }>(
          'SELECT MIN(expires_at) AS expires_at FROM active_leases WHERE expires_at > ?',
          now,
        )[0]?.expires_at;
        return reserveRejection('rate-limited', earliest === undefined ? null : new Date(earliest).toISOString());
      }

      const month = monthBucket(now);
      const cost = this.cost(month);
      const budget = this.budgetLimit();
      if (budget === null || cost.spent + cost.reserved + reserveMicros > budget) {
        return reserveRejection('budget-exceeded', null, nextMonth(now));
      }

      const newLeaseId = crypto.randomUUID();
      const leaseExpiresAt = now + GATEWAY_LIMITS.leaseMs;
      const idempotencyExpiresAt = now + GATEWAY_LIMITS.idempotencyMs;
      this.changeDaily(account, day, 1, 0);
      this.changeDaily(GLOBAL_SCOPE, day, 1, 0);
      this.changeCost(month, 0, reserveMicros);
      this.exec(
        `INSERT INTO active_leases (
          lease_id, account_key, idempotency_key, fingerprint, day_bucket, month_bucket,
          initial_reserve_micros, retry_reserve_micros, invoked, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
        newLeaseId,
        account,
        idem,
        requestFingerprint,
        day,
        month,
        reserveMicros,
        leaseExpiresAt,
      );
      this.exec(
        `INSERT INTO idempotency (
          account_key, idempotency_key, fingerprint, state, lease_id,
          cache_iv, cache_ciphertext, cache_expires_at, error_code, expires_at
        ) VALUES (?, ?, ?, 'reserved', ?, NULL, NULL, NULL, NULL, ?)`,
        account,
        idem,
        requestFingerprint,
        newLeaseId,
        idempotencyExpiresAt,
      );
      return { kind: 'reserved', leaseId: newLeaseId };
    });
  }

  async markInvoked(input: LeaseInput): Promise<void> {
    const value = leaseInput(input);
    this.ctx.storage.transactionSync(() => {
      this.cleanup(value.now);
      const lease = this.getLease(value);
      if (lease.invoked === 1) return;
      this.changeDaily(lease.account_key, lease.day_bucket, -1, 1);
      this.changeDaily(GLOBAL_SCOPE, lease.day_bucket, -1, 1);
      this.exec('UPDATE active_leases SET invoked = 1 WHERE lease_id = ?', lease.lease_id);
      this.exec(
        `UPDATE idempotency SET state = 'invoked'
         WHERE account_key = ? AND idempotency_key = ? AND lease_id = ?`,
        lease.account_key,
        lease.idempotency_key,
        lease.lease_id,
      );
    });
  }

  async abortAfterMarkBeforeProvider(input: LeaseInput): Promise<void> {
    const value = leaseInput(input);
    this.ctx.storage.transactionSync(() => {
      this.cleanup(value.now);
      const lease = this.getLease(value);
      if (lease.invoked !== 1 || lease.retry_reserve_micros !== 0) return rejectedOperation();
      this.changeDaily(lease.account_key, lease.day_bucket, 0, -1);
      this.changeDaily(GLOBAL_SCOPE, lease.day_bucket, 0, -1);
      this.changeCost(lease.month_bucket, 0, -lease.initial_reserve_micros);
      this.exec('DELETE FROM active_leases WHERE lease_id = ?', lease.lease_id);
      this.exec(
        `DELETE FROM idempotency
         WHERE account_key = ? AND idempotency_key = ? AND lease_id = ?`,
        lease.account_key,
        lease.idempotency_key,
        lease.lease_id,
      );
    });
  }

  async reserveRetryCost(input: LeaseInput): Promise<void> {
    const value = leaseInput(input);
    this.ctx.storage.transactionSync(() => {
      this.cleanup(value.now);
      const lease = this.getLease(value);
      if (lease.invoked !== 1 || lease.retry_reserve_micros !== 0) return rejectedOperation();
      const cost = this.cost(lease.month_bucket);
      const budget = this.budgetLimit();
      if (budget === null || cost.spent + cost.reserved + GATEWAY_LIMITS.retryAttemptReserveMicros > budget) {
        return rejectedOperation();
      }
      this.changeCost(lease.month_bucket, 0, GATEWAY_LIMITS.retryAttemptReserveMicros);
      this.exec(
        'UPDATE active_leases SET retry_reserve_micros = ? WHERE lease_id = ?',
        GATEWAY_LIMITS.retryAttemptReserveMicros,
        lease.lease_id,
      );
    });
  }

  async abortBeforeInvoke(input: LeaseInput): Promise<void> {
    const value = leaseInput(input);
    this.ctx.storage.transactionSync(() => {
      this.cleanup(value.now);
      const lease = this.getLease(value);
      if (lease.invoked !== 0 || lease.retry_reserve_micros !== 0) return rejectedOperation();
      this.changeDaily(lease.account_key, lease.day_bucket, -1, 0);
      this.changeDaily(GLOBAL_SCOPE, lease.day_bucket, -1, 0);
      this.changeCost(lease.month_bucket, 0, -lease.initial_reserve_micros);
      this.exec('DELETE FROM active_leases WHERE lease_id = ?', lease.lease_id);
      this.exec(
        `DELETE FROM idempotency
         WHERE account_key = ? AND idempotency_key = ? AND lease_id = ?`,
        lease.account_key,
        lease.idempotency_key,
        lease.lease_id,
      );
    });
  }

  private settle(value: LeaseInput, actualCostMicros: number | null): LeaseRow {
    this.cleanup(value.now);
    const lease = this.getLease(value);
    if (lease.invoked !== 1) return rejectedOperation();
    const reserved = lease.initial_reserve_micros + lease.retry_reserve_micros;
    const actual = actualCostMicros === null ? reserved : safeMicros(actualCostMicros);
    if (actual > reserved) return rejectedOperation();
    this.changeCost(lease.month_bucket, actual, -reserved);
    this.exec('DELETE FROM active_leases WHERE lease_id = ?', lease.lease_id);
    return lease;
  }

  async settleSuccess(input: SettleSuccessInput): Promise<void> {
    const value = leaseInput(input);
    const cache = cacheValue(input.cache, value.now);
    this.ctx.storage.transactionSync(() => {
      const lease = this.settle(value, input.actualCostMicros);
      this.exec(
        `UPDATE idempotency SET state = 'succeeded', lease_id = NULL,
           cache_iv = ?, cache_ciphertext = ?, cache_expires_at = ?, error_code = NULL
         WHERE account_key = ? AND idempotency_key = ? AND fingerprint = ?`,
        cache.ivBase64,
        cache.ciphertextBase64,
        cache.expiresAt,
        lease.account_key,
        lease.idempotency_key,
        lease.fingerprint,
      );
    });
  }

  async settleFailure(input: SettleFailureInput): Promise<void> {
    const value = leaseInput(input);
    if (input.actualCostMicros !== null) safeMicros(input.actualCostMicros);
    const errorCode = failureCode(input.errorCode);
    this.ctx.storage.transactionSync(() => {
      const lease = this.settle(value, input.actualCostMicros);
      this.exec(
        `UPDATE idempotency SET state = 'failed', lease_id = NULL,
           cache_iv = NULL, cache_ciphertext = NULL, cache_expires_at = NULL, error_code = ?
         WHERE account_key = ? AND idempotency_key = ? AND fingerprint = ?`,
        errorCode,
        lease.account_key,
        lease.idempotency_key,
        lease.fingerprint,
      );
    });
  }

  async setGlobalEnabled(enabled: boolean): Promise<void> {
    if (typeof enabled !== 'boolean') return invalid();
    this.ctx.storage.transactionSync(() => this.setSetting('global_enabled', enabled ? 1 : 0));
  }

  async setAccountEnabled(account: string, enabled: boolean): Promise<void> {
    const normalized = accountKey(account);
    if (typeof enabled !== 'boolean') return invalid();
    this.ctx.storage.transactionSync(() => {
      const existing = this.rows<{ enabled: number }>(
        'SELECT enabled FROM account_flags WHERE account_key = ?',
        normalized,
      )[0]?.enabled === 1;
      if (enabled && !existing) {
        const enabledAccounts = this.rows<CountRow>(
          'SELECT COUNT(*) AS count FROM account_flags WHERE enabled = 1',
        )[0]?.count ?? 0;
        if (enabledAccounts >= GATEWAY_LIMITS.betaAccounts) return rejectedOperation();
      }
      this.exec(
        `INSERT INTO account_flags (account_key, enabled) VALUES (?, ?)
         ON CONFLICT(account_key) DO UPDATE SET enabled = excluded.enabled`,
        normalized,
        enabled ? 1 : 0,
      );
    });
  }

  async deleteAccount(account: string): Promise<void> {
    const normalized = accountKey(account);
    this.ctx.storage.transactionSync(() => {
      const leases = this.rows<LeaseRow>(
        `SELECT lease_id, account_key, idempotency_key, fingerprint, day_bucket, month_bucket,
                initial_reserve_micros, retry_reserve_micros, invoked, expires_at
         FROM active_leases WHERE account_key = ? ORDER BY lease_id`,
        normalized,
      );
      for (const lease of leases) {
        const totalReserve = lease.initial_reserve_micros + lease.retry_reserve_micros;
        if (lease.invoked === 0) {
          this.changeDaily(GLOBAL_SCOPE, lease.day_bucket, -1, 0);
          this.changeCost(lease.month_bucket, 0, -totalReserve);
        } else {
          this.changeCost(lease.month_bucket, totalReserve, -totalReserve);
        }
      }
      this.exec('DELETE FROM active_leases WHERE account_key = ?', normalized);
      this.exec('DELETE FROM idempotency WHERE account_key = ?', normalized);
      this.exec('DELETE FROM minute_counters WHERE account_key = ?', normalized);
      this.exec('DELETE FROM daily_counters WHERE scope = ?', normalized);
      this.exec('DELETE FROM account_flags WHERE account_key = ?', normalized);
    });
  }
}
