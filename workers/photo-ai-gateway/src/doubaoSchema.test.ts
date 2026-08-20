import { describe, expect, test, vi } from 'vitest';

import * as candidatePolicy from '../../../src/lib/photoAiCandidate';
import { PRESET_FOODS } from '../../../src/data/presetFoods';
import {
  DOUBAO_ESTIMATE_JSON_SCHEMA,
  parseDoubaoEstimate,
  validateDoubaoEstimate,
} from './doubaoSchema';

type RawCandidate = {
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
};

function rawCandidate(overrides: Partial<RawCandidate> = {}): RawCandidate {
  return {
    name: '番茄炒蛋',
    preparation: '炒制，少油',
    amountLow: 180,
    amountHigh: 240,
    unit: 'g',
    catalogFoodId: null,
    nutrientSource: 'model-range',
    energyKcalLow: 210,
    energyKcalHigh: 280,
    proteinGLow: 12,
    proteinGHigh: 17,
    assumptions: ['按少油烹饪估算'],
    ...overrides,
  };
}

function payload(candidates: unknown[]): { candidates: unknown[] } {
  return { candidates };
}

describe('parseDoubaoEstimate', () => {
  test('maps model ranges, allocates server IDs and applies uncertainty exactly once', () => {
    const widen = vi.spyOn(candidatePolicy, 'applyPhotoUncertaintyV1');
    const result = parseDoubaoEstimate(payload([rawCandidate()]));

    expect(widen).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{
      id: 'candidate-1',
      name: '番茄炒蛋',
      preparation: '炒制，少油',
      amountLow: 180,
      amountHigh: 240,
      unit: 'g',
      catalogFoodId: null,
      nutrientSource: 'model-range',
      energyKcalLow: 168,
      energyKcalHigh: 336,
      proteinGLow: 9.6,
      proteinGHigh: 20.4,
      assumptions: ['按少油烹饪估算'],
    }]);
    widen.mockRestore();
  });

  test('resolves exact preset IDs and discards all model nutrition for catalog matches', () => {
    const food = PRESET_FOODS[1];
    const result = parseDoubaoEstimate(JSON.stringify(payload([rawCandidate({
      name: '模型伪造名称',
      preparation: '水煮',
      catalogFoodId: food.id,
      nutrientSource: 'catalog',
      energyKcalLow: 1,
      energyKcalHigh: 999,
      proteinGLow: 1,
      proteinGHigh: 999,
      assumptions: [],
    })])));

    expect(result[0]).toMatchObject({
      id: 'candidate-1',
      name: food.name,
      preparation: '水煮',
      catalogFoodId: food.id,
      nutrientSource: 'catalog',
      energyKcalLow: null,
      energyKcalHigh: null,
      proteinGLow: null,
      proteinGHigh: null,
    });
  });

  test('keeps a closed none candidate with no nutrient claims', () => {
    expect(parseDoubaoEstimate(payload([rawCandidate({
      name: '无法确定',
      preparation: '无法确定做法',
      nutrientSource: 'none',
      energyKcalLow: null,
      energyKcalHigh: null,
      proteinGLow: null,
      proteinGHigh: null,
      assumptions: [],
    })]))[0]).toMatchObject({
      id: 'candidate-1',
      nutrientSource: 'none',
      energyKcalLow: null,
      proteinGLow: null,
    });
  });

  test('allocates candidate-1 through candidate-6 without trusting model IDs', () => {
    const candidates = Array.from({ length: 6 }, (_, index) => rawCandidate({
      name: `菜品${index + 1}`,
      preparation: `做法${index + 1}`,
    }));
    expect(parseDoubaoEstimate(payload(candidates)).map((row) => row.id)).toEqual([
      'candidate-1', 'candidate-2', 'candidate-3',
      'candidate-4', 'candidate-5', 'candidate-6',
    ]);
  });

  test('exports a strict closed-world schema with at most six candidates', () => {
    expect(DOUBAO_ESTIMATE_JSON_SCHEMA).toMatchObject({
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
            properties: {
              preparation: { type: 'string', minLength: 1, maxLength: 120 },
              energyKcalLow: { type: ['number', 'null'], minimum: 0, maximum: 100_000 },
              proteinGLow: { type: ['number', 'null'], minimum: 0, maximum: 10_000 },
            },
          },
        },
      },
    });
  });

  test('deep-freezes every nested schema authority object', () => {
    expect(Object.isFrozen(DOUBAO_ESTIMATE_JSON_SCHEMA)).toBe(true);
    expect(Object.isFrozen(DOUBAO_ESTIMATE_JSON_SCHEMA.properties)).toBe(true);
    expect(Object.isFrozen(DOUBAO_ESTIMATE_JSON_SCHEMA.properties.candidates)).toBe(true);
    expect(Object.isFrozen(DOUBAO_ESTIMATE_JSON_SCHEMA.properties.candidates.items.properties)).toBe(true);
    expect(() => {
      (DOUBAO_ESTIMATE_JSON_SCHEMA.properties.candidates as { maxItems: number }).maxItems = 7;
    }).toThrow(TypeError);
  });

  test('validates and snapshots provider output without allocating IDs or widening ranges', () => {
    const widen = vi.spyOn(candidatePolicy, 'applyPhotoUncertaintyV1');
    const source = payload([rawCandidate()]);
    const validated = validateDoubaoEstimate(source);

    expect(widen).not.toHaveBeenCalled();
    expect(validated).toEqual(source);
    expect(validated).not.toBe(source);
    expect(validated.candidates[0]).not.toBe(source.candidates[0]);

    source.candidates[0] = rawCandidate({ name: '篡改' });
    expect(parseDoubaoEstimate(validated)[0]).toMatchObject({
      id: 'candidate-1',
      name: '番茄炒蛋',
      energyKcalLow: 168,
      energyKcalHigh: 336,
    });
    expect(widen).toHaveBeenCalledTimes(1);
    widen.mockRestore();
  });

  test.each([
    ['non-JSON', 'not json'],
    ['Markdown fence', '```json\n{"candidates":[]}\n```'],
    ['empty candidates', payload([])],
    ['root extra key', { candidates: [], leaked: true }],
    ['more than six candidates', payload(Array.from({ length: 7 }, (_, index) => rawCandidate({ name: `x${index}` })))],
    ['model supplied ID', payload([{ ...rawCandidate(), id: 'attacker-id' }])],
    ['unknown catalog ID', payload([rawCandidate({ catalogFoodId: 'food:preset:unknown', nutrientSource: 'catalog' })])],
    ['long string', payload([rawCandidate({ name: 'x'.repeat(121) })])],
    ['blank preparation', payload([rawCandidate({ preparation: '  ' })])],
    ['invalid enum', payload([{ ...rawCandidate(), unit: 'serving' }])],
    ['NaN', payload([rawCandidate({ amountLow: Number.NaN })])],
    ['Infinity', payload([rawCandidate({ proteinGHigh: Number.POSITIVE_INFINITY })])],
    ['inverted amount range', payload([rawCandidate({ amountLow: 300, amountHigh: 200 })])],
    ['inverted nutrient range', payload([rawCandidate({ energyKcalLow: 300, energyKcalHigh: 200 })])],
    ['partial model nutrients', payload([rawCandidate({ proteinGHigh: null })])],
    ['none with nutrient numbers', payload([rawCandidate({ nutrientSource: 'none', assumptions: [] })])],
    ['none with catalog ID', payload([rawCandidate({ nutrientSource: 'none', catalogFoodId: PRESET_FOODS[0].id, energyKcalLow: null, energyKcalHigh: null, proteinGLow: null, proteinGHigh: null, assumptions: [] })])],
    ['model range without assumptions', payload([rawCandidate({ assumptions: [] })])],
    ['model range with catalog ID', payload([rawCandidate({ catalogFoodId: PRESET_FOODS[0].id })])],
    ['catalog with partial nutrients', payload([rawCandidate({ catalogFoodId: PRESET_FOODS[0].id, nutrientSource: 'catalog', proteinGHigh: null })])],
    ['duplicate candidates', payload([rawCandidate(), rawCandidate()])],
  ])('rejects %s', (_label, value) => {
    expect(() => parseDoubaoEstimate(value)).toThrow('Invalid model output');
  });

  test('rejects sparse candidate and assumption arrays', () => {
    const sparseCandidates = new Array(1);
    expect(() => parseDoubaoEstimate(payload(sparseCandidates))).toThrow('Invalid model output');
    const sparseAssumptions = new Array(1) as string[];
    expect(() => parseDoubaoEstimate(payload([rawCandidate({ assumptions: sparseAssumptions })]))).toThrow('Invalid model output');
  });

  test('returns deep snapshots that do not follow later input mutation', () => {
    const assumption = ['原始假设'];
    const row = rawCandidate({ assumptions: assumption });
    const result = parseDoubaoEstimate(payload([row]));
    row.name = '篡改';
    assumption[0] = '篡改';
    expect(result[0].name).toBe('番茄炒蛋');
    expect(result[0].assumptions).toEqual(['原始假设']);
  });
});
