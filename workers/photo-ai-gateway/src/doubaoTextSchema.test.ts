import { describe, expect, test } from 'vitest';

import {
  DOUBAO_TEXT_JSON_SCHEMA,
  parseDoubaoTextEstimate,
} from './doubaoTextSchema';

const CANDIDATE_KEYS = [
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

function completeCandidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: '少油牛肉面',
    preparation: '整餐文字估算',
    amountLow: 450,
    amountHigh: 550,
    unit: 'g',
    catalogFoodId: null,
    nutrientSource: 'model-range',
    energyKcalLow: 560,
    energyKcalHigh: 780,
    proteinGLow: 28,
    proteinGHigh: 42,
    assumptions: ['按一碗面、熟牛肉和少量油估算'],
    ...overrides,
  };
}

describe('parseDoubaoTextEstimate', () => {
  test('accepts exactly one complete meal or an explicit uncertain result', () => {
    expect(parseDoubaoTextEstimate({
      status: 'complete',
      candidate: completeCandidate(),
    })).toEqual({
      status: 'complete',
      candidate: completeCandidate(),
    });
    expect(parseDoubaoTextEstimate({
      status: 'uncertain',
      candidate: null,
    })).toEqual({ status: 'uncertain', candidate: null });
  });

  test('exports a deeply frozen Ark-compatible root object schema with exact complete fields', () => {
    expect(DOUBAO_TEXT_JSON_SCHEMA).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['status', 'candidate'],
      properties: {
        status: { type: 'string', enum: ['complete', 'uncertain'] },
        candidate: {
          anyOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: [...CANDIDATE_KEYS],
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 120 },
                preparation: { type: 'string', minLength: 1, maxLength: 120 },
                amountLow: { type: 'number', minimum: 0.01, maximum: 100_000 },
                amountHigh: { type: 'number', minimum: 0.01, maximum: 100_000 },
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
                  maxItems: 8,
                  items: { type: 'string', minLength: 1, maxLength: 240 },
                },
              },
            },
            { type: 'null' },
          ],
        },
      },
    });
    expect(Object.keys(DOUBAO_TEXT_JSON_SCHEMA).sort()).toEqual([
      'additionalProperties',
      'properties',
      'required',
      'type',
    ]);
    const schema = DOUBAO_TEXT_JSON_SCHEMA as unknown as {
      properties: {
        candidate: {
          anyOf: readonly [
            { properties: Record<string, unknown>; additionalProperties: boolean },
            { type: string },
          ];
        };
      };
    };
    expect(Object.isFrozen(DOUBAO_TEXT_JSON_SCHEMA)).toBe(true);
    expect(Object.isFrozen(schema.properties.candidate.anyOf)).toBe(true);
    expect(Object.isFrozen(schema.properties.candidate.anyOf[0].properties)).toBe(true);
    expect(() => {
      schema.properties.candidate.anyOf[0].additionalProperties = true;
    }).toThrow(TypeError);
  });

  test.each([
    ['catalog ID', completeCandidate({ catalogFoodId: 'food:preset:usda:168878' })],
    ['catalog source', completeCandidate({ nutrientSource: 'catalog' })],
    ['none source', completeCandidate({ nutrientSource: 'none' })],
    ['empty assumptions', completeCandidate({ assumptions: [] })],
    ['too many assumptions', completeCandidate({ assumptions: Array.from({ length: 9 }, () => '假设') })],
    ['blank assumption', completeCandidate({ assumptions: ['   '] })],
    ['unsafe assumption', completeCandidate({ assumptions: ['正常\u2028伪装'] })],
    ['long assumption', completeCandidate({ assumptions: ['x'.repeat(241)] })],
    ['inverted amount', completeCandidate({ amountLow: 600, amountHigh: 500 })],
    ['inverted energy', completeCandidate({ energyKcalLow: 900, energyKcalHigh: 400 })],
    ['inverted protein', completeCandidate({ proteinGLow: 60, proteinGHigh: 20 })],
    ['amount below contract', completeCandidate({ amountLow: 0 })],
    ['amount above contract', completeCandidate({ amountHigh: 100_001 })],
    ['energy above contract', completeCandidate({ energyKcalHigh: 100_001 })],
    ['protein above contract', completeCandidate({ proteinGHigh: 10_001 })],
    ['NaN', completeCandidate({ proteinGLow: Number.NaN })],
    ['Infinity', completeCandidate({ energyKcalHigh: Number.POSITIVE_INFINITY })],
    ['negative zero', completeCandidate({ energyKcalLow: -0 })],
    ['unsafe name', completeCandidate({ name: '牛肉\u200b面' })],
    ['blank preparation', completeCandidate({ preparation: '  ' })],
    ['long name', completeCandidate({ name: 'x'.repeat(121) })],
    ['invalid unit', completeCandidate({ unit: 'kg' })],
    ['extra candidate key', completeCandidate({ secondCandidate: null })],
  ])('rejects invalid complete candidate: %s', (_label, candidate) => {
    expect(() => parseDoubaoTextEstimate({ status: 'complete', candidate }))
      .toThrow('Invalid model output');
  });

  test.each([
    ['wrong root status', { status: 'partial', candidate: null }],
    ['uncertain candidate', { status: 'uncertain', candidate: completeCandidate() }],
    ['root extra key', { status: 'uncertain', candidate: null, leaked: true }],
    ['second candidate container', { status: 'complete', candidate: completeCandidate(), candidates: [completeCandidate()] }],
    ['missing candidate', { status: 'uncertain' }],
    ['array root', []],
    ['non-object root', 'uncertain'],
  ])('rejects closed-union violation: %s', (_label, value) => {
    expect(() => parseDoubaoTextEstimate(value)).toThrow('Invalid model output');
  });

  test('rejects accessors, symbol keys, exotic prototypes and sparse or decorated arrays', () => {
    const accessorRoot = Object.defineProperty({}, 'status', {
      enumerable: true,
      get: () => 'uncertain',
    });
    Object.defineProperty(accessorRoot, 'candidate', { enumerable: true, value: null });
    expect(() => parseDoubaoTextEstimate(accessorRoot)).toThrow('Invalid model output');

    const symbolRoot = { status: 'uncertain', candidate: null, [Symbol('secret')]: true };
    expect(() => parseDoubaoTextEstimate(symbolRoot)).toThrow('Invalid model output');

    const inherited = Object.create({ status: 'uncertain' }) as Record<string, unknown>;
    inherited.candidate = null;
    expect(() => parseDoubaoTextEstimate(inherited)).toThrow('Invalid model output');

    const sparse = new Array(1) as string[];
    expect(() => parseDoubaoTextEstimate({
      status: 'complete',
      candidate: completeCandidate({ assumptions: sparse }),
    })).toThrow('Invalid model output');

    const decorated = Object.assign(['合法假设'], { leaked: true });
    expect(() => parseDoubaoTextEstimate({
      status: 'complete',
      candidate: completeCandidate({ assumptions: decorated }),
    })).toThrow('Invalid model output');
  });

  test('does not invoke value getters and returns a detached deep snapshot', () => {
    let getterInvoked = false;
    const sourceCandidate = completeCandidate({ assumptions: ['原始假设'] });
    Object.defineProperty(sourceCandidate, 'name', {
      enumerable: true,
      get() {
        getterInvoked = true;
        return '攻击者';
      },
    });
    expect(() => parseDoubaoTextEstimate({
      status: 'complete',
      candidate: sourceCandidate,
    })).toThrow('Invalid model output');
    expect(getterInvoked).toBe(false);

    let proxyGetInvoked = false;
    const proxiedCandidate = new Proxy(completeCandidate(), {
      get(target, key, receiver) {
        proxyGetInvoked = true;
        return Reflect.get(target, key, receiver);
      },
    });
    const proxyResult = parseDoubaoTextEstimate({
      status: 'complete',
      candidate: proxiedCandidate,
    });
    expect(proxyGetInvoked).toBe(false);
    expect(proxyResult.status).toBe('complete');

    const assumption = ['原始假设'];
    const candidate = completeCandidate({ assumptions: assumption });
    const result = parseDoubaoTextEstimate({ status: 'complete', candidate });
    candidate.name = '篡改名称';
    assumption[0] = '篡改假设';
    expect(result).toEqual({
      status: 'complete',
      candidate: completeCandidate({ assumptions: ['原始假设'] }),
    });
    expect(result.candidate).not.toBe(candidate);
    if (result.status === 'complete') {
      expect(result.candidate.assumptions).not.toBe(assumption);
    }
  });
});
