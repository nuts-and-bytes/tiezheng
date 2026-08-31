import { describe, expect, test, vi } from 'vitest';

import {
  createTextDiagnosticTrace,
  type TextDiagnosticRecord,
} from './textDiagnostics';

const TRACE_ID = '11111111-1111-4111-8111-111111111111';

function harness() {
  const records: TextDiagnosticRecord[] = [];
  const now = vi.fn()
    .mockReturnValueOnce(1_000)
    .mockReturnValueOnce(1_000)
    .mockReturnValueOnce(1_025);
  const randomUUID = vi.fn(() => TRACE_ID);
  const write = vi.fn((record: TextDiagnosticRecord) => {
    records.push(structuredClone(record));
  });
  return { records, now, randomUUID, write };
}

describe('text AI privacy-safe diagnostics', () => {
  test('emits only fixed lifecycle fields and bounded enum details', () => {
    const dependencies = harness();
    const trace = createTextDiagnosticTrace(true, dependencies);

    trace.emit('request-received');
    trace.emit('reservation-failed', {
      code: 'provider-timeout',
      reservationKind: 'failed',
      aborted: false,
    });

    expect(dependencies.records).toEqual([
      {
        event: 'tiezheng.text-ai.lifecycle',
        traceId: TRACE_ID,
        stage: 'request-received',
        elapsedMs: 0,
      },
      {
        event: 'tiezheng.text-ai.lifecycle',
        traceId: TRACE_ID,
        stage: 'reservation-failed',
        elapsedMs: 25,
        code: 'provider-timeout',
        reservationKind: 'failed',
        aborted: false,
      },
    ]);
    expect(Object.keys(dependencies.records[0] ?? {})).toEqual([
      'event',
      'traceId',
      'stage',
      'elapsedMs',
    ]);
    expect(JSON.stringify(dependencies.records)).not.toMatch(
      /description|account|email|access|api.?key|model.?response/i,
    );
  });

  test('disabled diagnostics do not touch clocks, randomness, or output', () => {
    const dependencies = harness();
    const trace = createTextDiagnosticTrace(false, dependencies);

    trace.emit('request-received');

    expect(dependencies.now).not.toHaveBeenCalled();
    expect(dependencies.randomUUID).not.toHaveBeenCalled();
    expect(dependencies.write).not.toHaveBeenCalled();
    expect(dependencies.records).toEqual([]);
  });

  test('diagnostic setup and output failures never escape into request handling', () => {
    expect(() => createTextDiagnosticTrace(true, {
      now: () => { throw new Error('private clock'); },
      randomUUID: () => { throw new Error('private random'); },
      write: () => { throw new Error('private sink'); },
    }).emit('request-received')).not.toThrow();

    const dependencies = harness();
    dependencies.write.mockImplementation(() => { throw new Error('private sink'); });
    const trace = createTextDiagnosticTrace(true, dependencies);

    expect(() => trace.emit('provider-started')).not.toThrow();
  });
});
