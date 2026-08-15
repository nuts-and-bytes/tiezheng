import type { Food } from '../lib/nutritionTypes';

const VERSION = 'USDA-FDC-SR-Legacy-2019-04-01';

type PresetFoodIdentity = Pick<
  Food,
  | 'id'
  | 'fdcId'
  | 'name'
  | 'aliases'
  | 'rawOrCooked'
  | 'preparation'
  | 'originalEnergyValue'
  | 'originalProteinG'
  | 'energyKcal'
  | 'proteinG'
  | 'source'
>;

function createPresetFood(identity: PresetFoodIdentity): Food {
  const food: Food = {
    ...identity,
    originalEnergyUnit: 'kcal',
    originalBasisAmount: 100,
    originalBasisUnit: 'g',
    basisAmount: 100,
    basisUnit: 'g',
    ediblePortionRatio: 1,
    densityGPerMl: null,
    conversionAssumptions: [
      'USDA cooked edible portion already reported per 100 g',
    ],
    fdcDataType: 'SR Legacy',
    sourceRetrievedAt: '2026-08-14',
    sourceVersion: VERSION,
    license: 'CC0 1.0',
    preset: true,
    updatedAt: 0,
    deletedAt: null,
  };

  Object.freeze(food.aliases);
  Object.freeze(food.conversionAssumptions);
  return Object.freeze(food);
}

const presetFoods: Food[] = [
  createPresetFood({
    id: 'food:preset:usda:168878',
    fdcId: 168878,
    name: '熟米饭',
    aliases: ['米饭'],
    rawOrCooked: 'cooked',
    preparation: '蒸煮',
    originalEnergyValue: 130,
    originalProteinG: 2.69,
    energyKcal: 130,
    proteinG: 2.69,
    source: 'USDA FoodData Central FDC 168878',
  }),
  createPresetFood({
    id: 'food:preset:usda:171477',
    fdcId: 171477,
    name: '熟鸡胸肉',
    aliases: ['鸡胸肉'],
    rawOrCooked: 'cooked',
    preparation: '去皮熟制',
    originalEnergyValue: 165,
    originalProteinG: 31,
    energyKcal: 165,
    proteinG: 31,
    source: 'USDA FoodData Central FDC 171477',
  }),
  createPresetFood({
    id: 'food:preset:usda:170236',
    fdcId: 170236,
    name: '熟瘦牛肉',
    aliases: ['牛肉'],
    rawOrCooked: 'cooked',
    preparation: '瘦肉熟制',
    originalEnergyValue: 190,
    originalProteinG: 36.1,
    energyKcal: 190,
    proteinG: 36.1,
    source: 'USDA FoodData Central FDC 170236',
  }),
];

Object.freeze(presetFoods);

// Keep the public Food[] view compatible with repositories and UI consumers.
// Runtime freezing remains intentional; clone before any caller-side mutation.
export const PRESET_FOODS: Food[] = presetFoods;
