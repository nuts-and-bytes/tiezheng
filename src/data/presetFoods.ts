import { normalizeFoodNutrients } from '../lib/foodNormalization';
import type { Food, FoodDataType } from '../lib/nutritionTypes';

interface PresetFoodSeed {
  id: string;
  fdcId: number | null;
  fdcDataType: FoodDataType | null;
  name: string;
  aliases: string[];
  rawOrCooked: Food['rawOrCooked'];
  preparation: string;
  originalEnergyValue: number;
  originalProteinG: number;
  originalBasisAmount: number;
  sourceRetrievedAt: string;
  source: string;
  sourceVersion: string;
  license: string;
  conversionAssumptions: string[];
}

function usda(
  fdcId: number,
  fdcDataType: Exclude<FoodDataType, 'Foundation' | 'Branded'>,
  name: string,
  aliases: string[],
  rawOrCooked: Food['rawOrCooked'],
  preparation: string,
  energyKcal: number,
  proteinG: number,
  sourceRetrievedAt = '2026-08-21',
): PresetFoodSeed {
  return {
    id: `food:preset:usda:${fdcId}`,
    fdcId,
    fdcDataType,
    name,
    aliases,
    rawOrCooked,
    preparation,
    originalEnergyValue: energyKcal,
    originalProteinG: proteinG,
    originalBasisAmount: 100,
    sourceRetrievedAt,
    source: `USDA FoodData Central FDC ${fdcId}`,
    sourceVersion:
      fdcDataType === 'SR Legacy'
        ? 'USDA-FDC-SR-Legacy-2019-04-01'
        : 'USDA-FDC-FNDDS-2021-2023-2024-10-31',
    license: 'CC0 1.0',
    conversionAssumptions: ['USDA edible portion reported per 100 g'],
  };
}

function createPresetFood(seed: PresetFoodSeed): Food {
  const normalized = normalizeFoodNutrients({
    originalEnergyValue: seed.originalEnergyValue,
    originalEnergyUnit: 'kcal',
    originalProteinG: seed.originalProteinG,
    originalBasisAmount: seed.originalBasisAmount,
    originalBasisUnit: 'g',
    normalizedBasisAmount: 100,
    normalizedBasisUnit: 'g',
    ediblePortionRatio: 1,
    densityGPerMl: null,
    conversionAssumptions: seed.conversionAssumptions,
  });
  const food: Food = {
    ...seed,
    originalEnergyUnit: 'kcal',
    originalBasisUnit: 'g',
    basisAmount: normalized.basisAmount,
    basisUnit: normalized.basisUnit,
    energyKcal: normalized.energyKcal,
    proteinG: normalized.proteinG,
    ediblePortionRatio: 1,
    densityGPerMl: null,
    conversionAssumptions: normalized.conversionAssumptions,
    preset: true,
    updatedAt: 0,
    deletedAt: null,
  };
  Object.freeze(food.aliases);
  Object.freeze(food.conversionAssumptions);
  return Object.freeze(food);
}

const seeds: PresetFoodSeed[] = [
  usda(168878, 'SR Legacy', '熟米饭', ['米饭'], 'cooked', '清水蒸煮', 130, 2.69, '2026-08-14'),
  usda(171477, 'SR Legacy', '熟鸡胸肉', ['鸡胸肉'], 'cooked', '去皮熟制', 165, 31, '2026-08-14'),
  usda(170236, 'SR Legacy', '熟瘦牛肉', ['牛肉'], 'cooked', '瘦肉熟制', 190, 36.1, '2026-08-14'),
  usda(173905, 'SR Legacy', '熟燕麦粥', ['燕麦粥', '燕麦'], 'cooked', '清水煮熟', 71, 2.54),
  usda(172688, 'SR Legacy', '全麦面包', ['全麦吐司'], 'not-applicable', '原味即食', 252, 12.4),
  usda(168483, 'SR Legacy', '熟红薯', ['红薯', '地瓜'], 'cooked', '烘烤熟制，无添加', 90, 2.01),
  usda(169999, 'SR Legacy', '熟玉米', ['玉米'], 'cooked', '水煮沥干，无盐', 96, 3.41),
  usda(170440, 'SR Legacy', '熟土豆', ['土豆', '马铃薯'], 'cooked', '去皮水煮，无盐', 86, 1.71),
  usda(172388, 'SR Legacy', '熟鸡腿肉', ['鸡腿肉'], 'cooked', '去皮烤制', 179, 24.8),
  usda(168250, 'SR Legacy', '熟猪里脊', ['猪里脊', '里脊肉'], 'cooked', '瘦肉烤制', 143, 26.2),
  usda(175168, 'SR Legacy', '熟三文鱼', ['三文鱼', '鲑鱼'], 'cooked', '大西洋养殖三文鱼干热熟制', 206, 22.1),
  usda(171971, 'SR Legacy', '熟虾仁', ['虾仁'], 'cooked', '湿热熟制', 119, 22.8),
  usda(173424, 'SR Legacy', '水煮蛋', ['鸡蛋', '煮鸡蛋'], 'cooked', '全蛋水煮', 155, 12.6),
  usda(172475, 'SR Legacy', '北豆腐', ['老豆腐'], 'not-applicable', '硫酸钙凝固硬豆腐', 144, 17.3),
  usda(171265, 'SR Legacy', '纯牛奶', ['牛奶'], 'not-applicable', '全脂 3.25%，无糖', 61, 3.15),
  usda(171284, 'SR Legacy', '原味酸奶', ['酸奶'], 'not-applicable', '全脂原味，无糖', 61, 3.47),
  usda(169967, 'SR Legacy', '西兰花', ['绿花椰菜'], 'cooked', '水煮沥干，无盐', 35, 2.38),
  usda(168463, 'SR Legacy', '菠菜', [], 'cooked', '水煮沥干，无盐', 23, 2.97),
  usda(170457, 'SR Legacy', '番茄', ['西红柿'], 'raw', '生食，可食部分', 18, 0.88),
  usda(168409, 'SR Legacy', '黄瓜', [], 'raw', '带皮生食，可食部分', 15, 0.65),
  usda(170393, 'SR Legacy', '胡萝卜', [], 'raw', '生食，可食部分', 41, 0.93),
  usda(171688, 'SR Legacy', '苹果', [], 'raw', '带皮生食，可食部分', 52, 0.26),
  usda(173944, 'SR Legacy', '香蕉', [], 'raw', '去皮生食，可食部分', 89, 1.09),
  usda(169097, 'SR Legacy', '橙子', [], 'raw', '去皮生食，可食部分', 47, 0.94),
  usda(2708352, 'Survey (FNDDS)', '熟面条', ['面条'], 'cooked', '清水煮熟，沥干', 137, 4.51),
  {
    id: 'food:preset:nhc:adult-sarcopenia-2026:mantou',
    fdcId: null,
    fdcDataType: null,
    name: '馒头',
    aliases: ['白馒头'],
    rawOrCooked: 'cooked',
    preparation: '原味无馅蒸制',
    originalEnergyValue: 335,
    originalProteinG: 10,
    originalBasisAmount: 150,
    sourceRetrievedAt: '2026-08-21',
    source: '国家卫生健康委《成人肌少症食养指南（2026年版）》表 2.9',
    sourceVersion: 'NHC-Adult-Sarcopenia-Diet-Guide-2026-Table-2.9',
    license: '国家卫生健康委公开指南（国卫办食品函〔2026〕114号）',
    conversionAssumptions: ['按指南表 2.9 的 150 g 原始份量线性换算到 100 g'],
  },
  usda(171986, 'SR Legacy', '金枪鱼', ['吞拿鱼'], 'not-applicable', '水浸罐头、沥干、无盐', 116, 25.5),
  usda(171956, 'SR Legacy', '鳕鱼', [], 'cooked', '大西洋鳕鱼干热熟制', 105, 22.8),
  usda(175215, 'SR Legacy', '无糖豆浆', ['豆浆'], 'not-applicable', '无糖强化豆浆', 33, 2.86),
  usda(169249, 'SR Legacy', '生菜', ['绿叶生菜'], 'raw', '绿叶生菜生食', 15, 1.36),
  usda(169975, 'SR Legacy', '卷心菜', ['包菜', '圆白菜'], 'raw', '生食，可食部分', 25, 1.28),
  usda(168437, 'SR Legacy', '香菇', [], 'cooked', '熟制，无盐', 56, 1.56),
  usda(167762, 'SR Legacy', '草莓', [], 'raw', '生食，可食部分', 32, 0.67),
];

const presetFoods: Food[] = seeds.map(createPresetFood);
Object.freeze(presetFoods);
export const PRESET_FOODS: Food[] = presetFoods;
