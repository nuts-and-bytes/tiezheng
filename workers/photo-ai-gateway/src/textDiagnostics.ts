import type { TextAiErrorCode } from '../../../src/lib/textAiContract';

export type TextDiagnosticStage =
  | 'request-received'
  | 'gateway-disabled'
  | 'gateway-ready'
  | 'lifecycle-invalid'
  | 'body-invalid'
  | 'body-parsed'
  | 'fingerprint-failed'
  | 'fingerprint-ready'
  | 'coordinator-unavailable'
  | 'reservation-pending'
  | 'reservation-reserved'
  | 'reservation-cached'
  | 'reservation-in-flight'
  | 'reservation-rejected'
  | 'reservation-failed'
  | 'adapter-unavailable'
  | 'adapter-ready'
  | 'provider-mark-pending'
  | 'provider-marked'
  | 'provider-started'
  | 'provider-failed'
  | 'provider-succeeded'
  | 'response-succeeded';

export type TextDiagnosticReservationKind =
  | 'reserved'
  | 'cached'
  | 'in-flight'
  | 'rejected'
  | 'failed';

export interface TextDiagnosticDetails {
  code?: TextAiErrorCode;
  reservationKind?: TextDiagnosticReservationKind;
  aborted?: boolean;
}

export interface TextDiagnosticRecord {
  event: 'tiezheng.text-ai.lifecycle';
  traceId: string;
  stage: TextDiagnosticStage;
  elapsedMs: number;
  code?: TextAiErrorCode;
  reservationKind?: TextDiagnosticReservationKind;
  aborted?: boolean;
}

export interface TextDiagnosticTrace {
  emit(stage: TextDiagnosticStage, details?: TextDiagnosticDetails): void;
}

export interface TextDiagnosticDependencies {
  now(): number;
  randomUUID(): string;
  write(record: TextDiagnosticRecord): void;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_ELAPSED_MS = 60_000;
const NOOP_TRACE: TextDiagnosticTrace = Object.freeze({
  emit() {
    // Diagnostics must never affect request handling.
  },
});

export const TEXT_DIAGNOSTIC_RUNTIME: TextDiagnosticDependencies = Object.freeze({
  now: Date.now,
  randomUUID: () => crypto.randomUUID(),
  write: (record: TextDiagnosticRecord) => console.log(record),
});

function safeTimestamp(value: unknown): number | null {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || Object.is(value, -0)
    || value < 0
  ) {
    return null;
  }
  return value;
}

export function createTextDiagnosticTrace(
  enabled: boolean,
  dependencies: TextDiagnosticDependencies = TEXT_DIAGNOSTIC_RUNTIME,
): TextDiagnosticTrace {
  if (!enabled) return NOOP_TRACE;

  let startedAt: number;
  let traceId: string;
  try {
    const timestamp = safeTimestamp(dependencies.now());
    const candidateTraceId = dependencies.randomUUID();
    if (timestamp === null || !UUID_PATTERN.test(candidateTraceId)) return NOOP_TRACE;
    startedAt = timestamp;
    traceId = candidateTraceId;
  } catch {
    return NOOP_TRACE;
  }

  return Object.freeze({
    emit(stage: TextDiagnosticStage, details: TextDiagnosticDetails = {}) {
      try {
        const current = safeTimestamp(dependencies.now());
        const elapsedMs = current === null
          ? 0
          : Math.min(MAX_ELAPSED_MS, Math.max(0, current - startedAt));
        const record: TextDiagnosticRecord = {
          event: 'tiezheng.text-ai.lifecycle',
          traceId,
          stage,
          elapsedMs,
        };
        if (details.code !== undefined) record.code = details.code;
        if (details.reservationKind !== undefined) {
          record.reservationKind = details.reservationKind;
        }
        if (details.aborted !== undefined) record.aborted = details.aborted;
        dependencies.write(Object.freeze(record));
      } catch {
        // Diagnostics must never affect request handling.
      }
    },
  });
}
