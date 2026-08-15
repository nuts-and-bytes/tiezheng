import { describe, expect, test } from 'vitest';
import type { FoodNormalizationInput } from './foodNormalization';
import { normalizeFoodNutrients } from './foodNormalization';

function input(overrides: Partial<FoodNormalizationInput> = {}): FoodNormalizationInput {
  return {
    originalEnergyValue: 418.4,
    originalEnergyUnit: 'kJ',
    originalProteinG: 10,
    originalBasisAmount: 100,
    originalBasisUnit: 'g',
    normalizedBasisAmount: 100,
    normalizedBasisUnit: 'g',
    ediblePortionRatio: 1,
    densityGPerMl: null,
    conversionAssumptions: ['source basis is edible food'],
    ...overrides,
  };
}

describe('normalizeFoodNutrients', () => {
  test('converts kJ to kcal, preserves protein, and leaves the input untouched', () => {
    const source = input();
    const snapshot = structuredClone(source);

    expect(normalizeFoodNutrients(source)).toEqual({
      basisAmount: 100,
      basisUnit: 'g',
      energyKcal: 100,
      proteinG: 10,
      conversionAssumptions: [
        'source basis is edible food',
        'energy converted from kJ using 1 kcal = 4.184 kJ',
      ],
    });
    expect(source).toEqual(snapshot);
  });

  test('scales a same-unit basis without requiring density or applying edible ratio twice', () => {
    expect(
      normalizeFoodNutrients(
        input({
          originalEnergyValue: 130,
          originalEnergyUnit: 'kcal',
          originalProteinG: 2.69,
          normalizedBasisAmount: 150,
          ediblePortionRatio: 0.8,
        }),
      ),
    ).toMatchObject({ energyKcal: 195, proteinG: 4.035 });
  });

  test('converts an original gram basis to a normalized millilitre basis with density', () => {
    expect(
      normalizeFoodNutrients(
        input({
          originalEnergyValue: 200,
          originalEnergyUnit: 'kcal',
          originalProteinG: 8,
          originalBasisUnit: 'g',
          normalizedBasisAmount: 100,
          normalizedBasisUnit: 'mL',
          densityGPerMl: 1.25,
          conversionAssumptions: [],
        }),
      ),
    ).toEqual({
      basisAmount: 100,
      basisUnit: 'mL',
      energyKcal: 250,
      proteinG: 10,
      conversionAssumptions: [
        '100 mL converted to 125 g using density 1.25 g/mL',
      ],
    });
  });

  test('converts an original millilitre basis to a normalized gram basis with density', () => {
    expect(
      normalizeFoodNutrients(
        input({
          originalEnergyValue: 60,
          originalEnergyUnit: 'kcal',
          originalProteinG: 3,
          originalBasisUnit: 'mL',
          normalizedBasisAmount: 100,
          normalizedBasisUnit: 'g',
          densityGPerMl: 0.8,
          conversionAssumptions: [],
        }),
      ),
    ).toEqual({
      basisAmount: 100,
      basisUnit: 'g',
      energyKcal: 75,
      proteinG: 3.75,
      conversionAssumptions: [
        '100 g converted to 125 mL using density 0.8 g/mL',
      ],
    });
  });

  test('records combined kJ and density provenance in processing order', () => {
    expect(
      normalizeFoodNutrients(
        input({
          normalizedBasisAmount: 100,
          normalizedBasisUnit: 'mL',
          densityGPerMl: 1.25,
        }),
      ),
    ).toEqual({
      basisAmount: 100,
      basisUnit: 'mL',
      energyKcal: 125,
      proteinG: 12.5,
      conversionAssumptions: [
        'source basis is edible food',
        'energy converted from kJ using 1 kcal = 4.184 kJ',
        '100 mL converted to 125 g using density 1.25 g/mL',
      ],
    });
  });

  test.each([null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'fails closed on cross-unit conversion with density %s',
    (densityGPerMl) => {
      expect(() =>
        normalizeFoodNutrients(
          input({ normalizedBasisUnit: 'mL', densityGPerMl }),
        ),
      ).toThrow(/density/i);
    },
  );

  test.each([
    ['originalEnergyValue', -1],
    ['originalEnergyValue', Number.NaN],
    ['originalProteinG', Number.POSITIVE_INFINITY],
    ['originalBasisAmount', 0],
    ['normalizedBasisAmount', -1],
    ['ediblePortionRatio', 0],
    ['ediblePortionRatio', 1.01],
  ] as const)('rejects invalid numeric %s', (field, value) => {
    expect(() => normalizeFoodNutrients(input({ [field]: value }))).toThrow();
  });

  test('rejects blank conversion assumptions', () => {
    expect(() =>
      normalizeFoodNutrients(input({ conversionAssumptions: ['  '] })),
    ).toThrow(/assumption/i);
  });

  test('fails closed when finite inputs would overflow normalized output', () => {
    expect(() =>
      normalizeFoodNutrients(
        input({
          originalEnergyValue: Number.MAX_VALUE,
          originalEnergyUnit: 'kcal',
          originalBasisAmount: 1,
          normalizedBasisAmount: 2,
        }),
      ),
    ).toThrow(/finite/i);
  });

  test('fails closed when stable rounding overflows a finite nutrient', () => {
    expect(() =>
      normalizeFoodNutrients(
        input({
          originalEnergyValue: 1e300,
          originalEnergyUnit: 'kcal',
        }),
      ),
    ).toThrow(/finite/i);
  });
});
