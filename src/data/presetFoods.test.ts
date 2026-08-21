import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename as renamePath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { expect, test } from 'vitest';
// The production asset script is an ESM-only Node module outside tsconfig's include set.
// @ts-expect-error TypeScript has no declaration file for this intentionally plain .mjs module.
import { PRESET_FOOD_IMAGE_OUTPUT_NAMES as UNTYPED_OUTPUT_NAMES } from '../../scripts/preset-food-image-output-names.mjs';
import { PRESET_FOOD_IMAGE_MANIFEST } from './presetFoodImageManifest.generated';
import { PRESET_FOODS } from './presetFoods';
import { normalizeFoodNutrients } from '../lib/foodNormalization';
import type { Food } from '../lib/nutritionTypes';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..');
const OUTPUT_NAMES = UNTYPED_OUTPUT_NAMES as readonly string[];
const EXPECTED_IMAGE_OUTPUT_NAMES = [
  'rice.webp',
  'chicken-breast.webp',
  'lean-beef.webp',
  'oatmeal-porridge.webp',
  'whole-wheat-bread.webp',
  'sweet-potato.webp',
  'sweet-corn.webp',
  'boiled-potato.webp',
  'chicken-thigh.webp',
  'pork-tenderloin.webp',
  'salmon.webp',
  'shrimp.webp',
  'boiled-egg.webp',
  'firm-tofu.webp',
  'whole-milk.webp',
  'plain-yogurt.webp',
  'broccoli.webp',
  'spinach.webp',
  'tomato.webp',
  'cucumber.webp',
  'carrot.webp',
  'apple.webp',
  'banana.webp',
  'orange.webp',
  'cooked-noodles.webp',
  'mantou.webp',
  'tuna.webp',
  'cod.webp',
  'unsweetened-soy-milk.webp',
  'leaf-lettuce.webp',
  'cabbage.webp',
  'shiitake.webp',
  'strawberry.webp',
] as const;

type PreparePresetFoodImages = (options: {
  sourcePaths: string[];
  outputDirectory: string;
}) => Promise<void>;

type EncodedPresetFoodFile = Readonly<{
  name: string;
  bytes: Uint8Array;
}>;

type ReplacePresetFoodOutputDirectory = (options: {
  outputDirectory: string;
  encodedFiles: readonly EncodedPresetFoodFile[];
  expectedOutputNames: readonly string[];
  operationId?: string;
  fileOps?: {
    rename?: (oldPath: string, newPath: string) => Promise<void>;
    remove?: (
      path: string,
      options: { recursive: boolean; force: boolean },
    ) => Promise<void>;
  };
}) => Promise<void>;

const EXPECTED_CATALOG = [
  [168878, 'SR Legacy', '熟米饭', 130, 2.69],
  [171477, 'SR Legacy', '熟鸡胸肉', 165, 31],
  [170236, 'SR Legacy', '熟瘦牛肉', 190, 36.1],
  [173905, 'SR Legacy', '熟燕麦粥', 71, 2.54],
  [172688, 'SR Legacy', '全麦面包', 252, 12.4],
  [168483, 'SR Legacy', '熟红薯', 90, 2.01],
  [169999, 'SR Legacy', '熟玉米', 96, 3.41],
  [170440, 'SR Legacy', '熟土豆', 86, 1.71],
  [172388, 'SR Legacy', '熟鸡腿肉', 179, 24.8],
  [168250, 'SR Legacy', '熟猪里脊', 143, 26.2],
  [175168, 'SR Legacy', '熟三文鱼', 206, 22.1],
  [171971, 'SR Legacy', '熟虾仁', 119, 22.8],
  [173424, 'SR Legacy', '水煮蛋', 155, 12.6],
  [172475, 'SR Legacy', '北豆腐', 144, 17.3],
  [171265, 'SR Legacy', '纯牛奶', 61, 3.15],
  [171284, 'SR Legacy', '原味酸奶', 61, 3.47],
  [169967, 'SR Legacy', '西兰花', 35, 2.38],
  [168463, 'SR Legacy', '菠菜', 23, 2.97],
  [170457, 'SR Legacy', '番茄', 18, 0.88],
  [168409, 'SR Legacy', '黄瓜', 15, 0.65],
  [170393, 'SR Legacy', '胡萝卜', 41, 0.93],
  [171688, 'SR Legacy', '苹果', 52, 0.26],
  [173944, 'SR Legacy', '香蕉', 89, 1.09],
  [169097, 'SR Legacy', '橙子', 47, 0.94],
  [2708352, 'Survey (FNDDS)', '熟面条', 137, 4.51],
  [null, null, '馒头', 223.333333333333, 6.666666666667],
  [171986, 'SR Legacy', '金枪鱼', 116, 25.5],
  [171956, 'SR Legacy', '鳕鱼', 105, 22.8],
  [175215, 'SR Legacy', '无糖豆浆', 33, 2.86],
  [169249, 'SR Legacy', '生菜', 15, 1.36],
  [169975, 'SR Legacy', '卷心菜', 25, 1.28],
  [168437, 'SR Legacy', '香菇', 56, 1.56],
  [167762, 'SR Legacy', '草莓', 32, 0.67],
] as const;

type ExpectedPresetFoodMetadata = readonly [
  id: string,
  fdcId: number | null,
  fdcDataType: Food['fdcDataType'],
  name: string,
  aliases: readonly string[],
  rawOrCooked: Food['rawOrCooked'],
  preparation: string,
  originalEnergyValue: number,
  originalProteinG: number,
  originalBasisAmount: number,
  energyKcal: number,
  proteinG: number,
  sourceRetrievedAt: string,
  source: string,
  sourceVersion: string,
  license: string,
  conversionAssumptions: readonly string[],
];

const EXPECTED_PRESET_FOOD_METADATA = [
  ['food:preset:usda:168878', 168878, 'SR Legacy', '熟米饭', ['米饭'], 'cooked', '清水蒸煮', 130, 2.69, 100, 130, 2.69, '2026-08-14', 'USDA FoodData Central FDC 168878', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:171477', 171477, 'SR Legacy', '熟鸡胸肉', ['鸡胸肉'], 'cooked', '去皮熟制', 165, 31, 100, 165, 31, '2026-08-14', 'USDA FoodData Central FDC 171477', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:170236', 170236, 'SR Legacy', '熟瘦牛肉', ['牛肉'], 'cooked', '瘦肉熟制', 190, 36.1, 100, 190, 36.1, '2026-08-14', 'USDA FoodData Central FDC 170236', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:173905', 173905, 'SR Legacy', '熟燕麦粥', ['燕麦粥', '燕麦'], 'cooked', '清水煮熟', 71, 2.54, 100, 71, 2.54, '2026-08-21', 'USDA FoodData Central FDC 173905', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:172688', 172688, 'SR Legacy', '全麦面包', ['全麦吐司'], 'not-applicable', '原味即食', 252, 12.4, 100, 252, 12.4, '2026-08-21', 'USDA FoodData Central FDC 172688', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:168483', 168483, 'SR Legacy', '熟红薯', ['红薯', '地瓜'], 'cooked', '烘烤熟制，无添加', 90, 2.01, 100, 90, 2.01, '2026-08-21', 'USDA FoodData Central FDC 168483', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:169999', 169999, 'SR Legacy', '熟玉米', ['玉米'], 'cooked', '水煮沥干，无盐', 96, 3.41, 100, 96, 3.41, '2026-08-21', 'USDA FoodData Central FDC 169999', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:170440', 170440, 'SR Legacy', '熟土豆', ['土豆', '马铃薯'], 'cooked', '去皮水煮，无盐', 86, 1.71, 100, 86, 1.71, '2026-08-21', 'USDA FoodData Central FDC 170440', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:172388', 172388, 'SR Legacy', '熟鸡腿肉', ['鸡腿肉'], 'cooked', '去皮烤制', 179, 24.8, 100, 179, 24.8, '2026-08-21', 'USDA FoodData Central FDC 172388', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:168250', 168250, 'SR Legacy', '熟猪里脊', ['猪里脊', '里脊肉'], 'cooked', '瘦肉烤制', 143, 26.2, 100, 143, 26.2, '2026-08-21', 'USDA FoodData Central FDC 168250', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:175168', 175168, 'SR Legacy', '熟三文鱼', ['三文鱼', '鲑鱼'], 'cooked', '大西洋养殖三文鱼干热熟制', 206, 22.1, 100, 206, 22.1, '2026-08-21', 'USDA FoodData Central FDC 175168', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:171971', 171971, 'SR Legacy', '熟虾仁', ['虾仁'], 'cooked', '湿热熟制', 119, 22.8, 100, 119, 22.8, '2026-08-21', 'USDA FoodData Central FDC 171971', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:173424', 173424, 'SR Legacy', '水煮蛋', ['鸡蛋', '煮鸡蛋'], 'cooked', '全蛋水煮', 155, 12.6, 100, 155, 12.6, '2026-08-21', 'USDA FoodData Central FDC 173424', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:172475', 172475, 'SR Legacy', '北豆腐', ['老豆腐'], 'not-applicable', '硫酸钙凝固硬豆腐', 144, 17.3, 100, 144, 17.3, '2026-08-21', 'USDA FoodData Central FDC 172475', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:171265', 171265, 'SR Legacy', '纯牛奶', ['牛奶'], 'not-applicable', '全脂 3.25%，无糖', 61, 3.15, 100, 61, 3.15, '2026-08-21', 'USDA FoodData Central FDC 171265', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:171284', 171284, 'SR Legacy', '原味酸奶', ['酸奶'], 'not-applicable', '全脂原味，无糖', 61, 3.47, 100, 61, 3.47, '2026-08-21', 'USDA FoodData Central FDC 171284', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:169967', 169967, 'SR Legacy', '西兰花', ['绿花椰菜'], 'cooked', '水煮沥干，无盐', 35, 2.38, 100, 35, 2.38, '2026-08-21', 'USDA FoodData Central FDC 169967', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:168463', 168463, 'SR Legacy', '菠菜', [], 'cooked', '水煮沥干，无盐', 23, 2.97, 100, 23, 2.97, '2026-08-21', 'USDA FoodData Central FDC 168463', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:170457', 170457, 'SR Legacy', '番茄', ['西红柿'], 'raw', '生食，可食部分', 18, 0.88, 100, 18, 0.88, '2026-08-21', 'USDA FoodData Central FDC 170457', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:168409', 168409, 'SR Legacy', '黄瓜', [], 'raw', '带皮生食，可食部分', 15, 0.65, 100, 15, 0.65, '2026-08-21', 'USDA FoodData Central FDC 168409', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:170393', 170393, 'SR Legacy', '胡萝卜', [], 'raw', '生食，可食部分', 41, 0.93, 100, 41, 0.93, '2026-08-21', 'USDA FoodData Central FDC 170393', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:171688', 171688, 'SR Legacy', '苹果', [], 'raw', '带皮生食，可食部分', 52, 0.26, 100, 52, 0.26, '2026-08-21', 'USDA FoodData Central FDC 171688', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:173944', 173944, 'SR Legacy', '香蕉', [], 'raw', '去皮生食，可食部分', 89, 1.09, 100, 89, 1.09, '2026-08-21', 'USDA FoodData Central FDC 173944', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:169097', 169097, 'SR Legacy', '橙子', [], 'raw', '去皮生食，可食部分', 47, 0.94, 100, 47, 0.94, '2026-08-21', 'USDA FoodData Central FDC 169097', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:2708352', 2708352, 'Survey (FNDDS)', '熟面条', ['面条'], 'cooked', '清水煮熟，沥干', 137, 4.51, 100, 137, 4.51, '2026-08-21', 'USDA FoodData Central FDC 2708352', 'USDA-FDC-FNDDS-2021-2023-2024-10-31', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:nhc:adult-sarcopenia-2026:mantou', null, null, '馒头', ['白馒头'], 'cooked', '原味无馅蒸制', 335, 10, 150, 223.333333333333, 6.666666666667, '2026-08-21', '国家卫生健康委《成人肌少症食养指南（2026年版）》表 2.9', 'NHC-Adult-Sarcopenia-Diet-Guide-2026-Table-2.9', '国家卫生健康委公开指南（国卫办食品函〔2026〕114号）', ['按指南表 2.9 的 150 g 原始份量线性换算到 100 g']],
  ['food:preset:usda:171986', 171986, 'SR Legacy', '金枪鱼', ['吞拿鱼'], 'not-applicable', '水浸罐头、沥干、无盐', 116, 25.5, 100, 116, 25.5, '2026-08-21', 'USDA FoodData Central FDC 171986', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:171956', 171956, 'SR Legacy', '鳕鱼', [], 'cooked', '大西洋鳕鱼干热熟制', 105, 22.8, 100, 105, 22.8, '2026-08-21', 'USDA FoodData Central FDC 171956', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:175215', 175215, 'SR Legacy', '无糖豆浆', ['豆浆'], 'not-applicable', '无糖强化豆浆', 33, 2.86, 100, 33, 2.86, '2026-08-21', 'USDA FoodData Central FDC 175215', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:169249', 169249, 'SR Legacy', '生菜', ['绿叶生菜'], 'raw', '绿叶生菜生食', 15, 1.36, 100, 15, 1.36, '2026-08-21', 'USDA FoodData Central FDC 169249', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:169975', 169975, 'SR Legacy', '卷心菜', ['包菜', '圆白菜'], 'raw', '生食，可食部分', 25, 1.28, 100, 25, 1.28, '2026-08-21', 'USDA FoodData Central FDC 169975', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:168437', 168437, 'SR Legacy', '香菇', [], 'cooked', '熟制，无盐', 56, 1.56, 100, 56, 1.56, '2026-08-21', 'USDA FoodData Central FDC 168437', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
  ['food:preset:usda:167762', 167762, 'SR Legacy', '草莓', [], 'raw', '生食，可食部分', 32, 0.67, 100, 32, 0.67, '2026-08-21', 'USDA FoodData Central FDC 167762', 'USDA-FDC-SR-Legacy-2019-04-01', 'CC0 1.0', ['USDA edible portion reported per 100 g']],
] as const satisfies readonly ExpectedPresetFoodMetadata[];

async function loadAssetPreparationModule() {
  const prepareUrl = pathToFileURL(
    resolve(REPOSITORY_ROOT, 'scripts/prepare-preset-food-images.mjs'),
  ).href;
  return (await import(/* @vite-ignore */ prepareUrl)) as {
    preparePresetFoodImages: PreparePresetFoodImages;
    replacePresetFoodOutputDirectory: ReplacePresetFoodOutputDirectory;
  };
}

function byteBatch(prefix: string): Buffer[] {
  return OUTPUT_NAMES.map((name) => Buffer.from(`${prefix}-${name}`));
}

function encodedBatch(values: readonly Uint8Array[]): EncodedPresetFoodFile[] {
  if (values.length !== OUTPUT_NAMES.length) {
    throw new Error('test fixture must contain exactly 33 encoded files');
  }
  return OUTPUT_NAMES.map((name, index) => ({ name, bytes: values[index] }));
}

async function writeBatch(
  directory: string,
  values: readonly Uint8Array[],
  names: readonly string[] = OUTPUT_NAMES,
) {
  if (values.length !== names.length) {
    throw new Error('fixture length mismatch');
  }
  await mkdir(directory, { recursive: true });
  await Promise.all(
    names.map((name, index) =>
      writeFile(resolve(directory, name), values[index]),
    ),
  );
}

async function readBatch(
  directory: string,
  names: readonly string[] = OUTPUT_NAMES,
) {
  return Promise.all(
    names.map((name) => readFile(resolve(directory, name))),
  );
}

async function coloredImage(
  index: number,
  format: 'png' | 'webp',
): Promise<Buffer> {
  const image = sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: {
        r: (index * 47) % 256,
        g: (index * 83) % 256,
        b: (index * 131) % 256,
        alpha: 1,
      },
    },
  });
  return format === 'png' ? image.png().toBuffer() : image.webp().toBuffer();
}

async function assetFixture() {
  const root = await mkdtemp(join(tmpdir(), 'tiezheng-food-assets-v2-'));
  const sourceDirectory = resolve(root, 'sources');
  const outputDirectory = resolve(root, 'food-presets');
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(
    OUTPUT_NAMES.map(async (name, index) =>
      writeFile(
        resolve(outputDirectory, name),
        await coloredImage(index + 1, 'webp'),
      ),
    ),
  );
  await writeFile(
    resolve(sourceDirectory, 'mantou.png'),
    await coloredImage(80, 'png'),
  );
  await writeFile(
    resolve(sourceDirectory, 'bao-bun.png'),
    await coloredImage(81, 'png'),
  );
  await writeFile(
    resolve(sourceDirectory, 'tuna.png'),
    await coloredImage(82, 'png'),
  );
  return {
    root,
    sourceDirectory,
    outputDirectory,
    before: await readBatch(outputDirectory),
  };
}

async function transactionArtifacts(parentDirectory: string) {
  return (await readdir(parentDirectory))
    .filter(
      (name) =>
        name.startsWith('.food-presets.staging-') ||
        name.startsWith('.food-presets.backup-') ||
        name === '.food-presets.lock',
    )
    .sort();
}

test('目录固定为 33 种基础食物并保留馒头', () => {
  expect(
    PRESET_FOODS.map((food) => [
      food.fdcId,
      food.fdcDataType,
      food.name,
      food.energyKcal,
      food.proteinG,
    ]),
  ).toEqual(EXPECTED_CATALOG);
  expect(new Set(PRESET_FOODS.map((food) => food.id)).size).toBe(33);
  expect(new Set(PRESET_FOODS.map((food) => food.name)).size).toBe(33);
});

test('图片输出名冻结为与 33 项目录对齐的固定顺序', () => {
  expect(OUTPUT_NAMES).toEqual(EXPECTED_IMAGE_OUTPUT_NAMES);
  expect(Object.isFrozen(OUTPUT_NAMES)).toBe(true);
});

test('33 项目录保留完整独立元数据快照', () => {
  expect(PRESET_FOODS).toHaveLength(EXPECTED_PRESET_FOOD_METADATA.length);
  expect(
    PRESET_FOODS.map((food) => [
      food.id,
      food.fdcId,
      food.fdcDataType,
      food.name,
      food.aliases,
      food.rawOrCooked,
      food.preparation,
      food.originalEnergyValue,
      food.originalProteinG,
      food.originalBasisAmount,
      food.energyKcal,
      food.proteinG,
      food.sourceRetrievedAt,
      food.source,
      food.sourceVersion,
      food.license,
      food.conversionAssumptions,
    ]),
  ).toEqual(EXPECTED_PRESET_FOOD_METADATA);

  for (const food of PRESET_FOODS) {
    expect(food).toMatchObject({
      originalEnergyUnit: 'kcal',
      originalBasisUnit: 'g',
      basisAmount: 100,
      basisUnit: 'g',
      ediblePortionRatio: 1,
      densityGPerMl: null,
      preset: true,
      updatedAt: 0,
      deletedAt: null,
    });
  }
});

test('馒头保留国家卫健委 150 g 原始基准并可无损复算', () => {
  const mantou = PRESET_FOODS.find((food) => food.name === '馒头');
  expect(mantou).toMatchObject({
    id: 'food:preset:nhc:adult-sarcopenia-2026:mantou',
    fdcId: null,
    fdcDataType: null,
    originalEnergyValue: 335,
    originalEnergyUnit: 'kcal',
    originalProteinG: 10,
    originalBasisAmount: 150,
    originalBasisUnit: 'g',
    basisAmount: 100,
    basisUnit: 'g',
    energyKcal: 223.333333333333,
    proteinG: 6.666666666667,
    sourceVersion: 'NHC-Adult-Sarcopenia-Diet-Guide-2026-Table-2.9',
    license: '国家卫生健康委公开指南（国卫办食品函〔2026〕114号）',
  });
  expect(mantou?.conversionAssumptions).toContain(
    '按指南表 2.9 的 150 g 原始份量线性换算到 100 g',
  );
});

test('每项保存原始基准且可由归一化函数复算', () => {
  for (const food of PRESET_FOODS) {
    const normalized = normalizeFoodNutrients({
      originalEnergyValue: food.originalEnergyValue,
      originalEnergyUnit: food.originalEnergyUnit,
      originalProteinG: food.originalProteinG,
      originalBasisAmount: food.originalBasisAmount,
      originalBasisUnit: food.originalBasisUnit,
      normalizedBasisAmount: food.basisAmount,
      normalizedBasisUnit: food.basisUnit,
      ediblePortionRatio: food.ediblePortionRatio,
      densityGPerMl: food.densityGPerMl,
      conversionAssumptions: food.conversionAssumptions.slice(0, 1),
    });
    expect(normalized.energyKcal).toBe(food.energyKcal);
    expect(normalized.proteinG).toBe(food.proteinG);
    expect(Number.isFinite(food.energyKcal)).toBe(true);
    expect(Number.isFinite(food.proteinG)).toBe(true);
  }
});

test('首批目录锁定官方 USDA 身份、快照和标准化值', () => {
  expect(
    PRESET_FOODS.slice(0, 3).map(
      ({ fdcId, fdcDataType, sourceVersion, energyKcal, proteinG, license }) => ({
        fdcId,
        fdcDataType,
        sourceVersion,
        energyKcal,
        proteinG,
        license,
      }),
    ),
  ).toEqual([
    {
      fdcId: 168878,
      fdcDataType: 'SR Legacy',
      sourceVersion: 'USDA-FDC-SR-Legacy-2019-04-01',
      energyKcal: 130,
      proteinG: 2.69,
      license: 'CC0 1.0',
    },
    {
      fdcId: 171477,
      fdcDataType: 'SR Legacy',
      sourceVersion: 'USDA-FDC-SR-Legacy-2019-04-01',
      energyKcal: 165,
      proteinG: 31,
      license: 'CC0 1.0',
    },
    {
      fdcId: 170236,
      fdcDataType: 'SR Legacy',
      sourceVersion: 'USDA-FDC-SR-Legacy-2019-04-01',
      energyKcal: 190,
      proteinG: 36.1,
      license: 'CC0 1.0',
    },
  ]);
  expect(
    PRESET_FOODS.slice(0, 3).every(
      (food) =>
        food.originalBasisAmount === 100 &&
        food.basisAmount === 100 &&
        food.sourceRetrievedAt === '2026-08-14',
    ),
  ).toBe(true);
});

test('预设目录在运行时深冻结，不共享可变嵌套数组', () => {
  expect(Object.isFrozen(PRESET_FOODS)).toBe(true);

  for (const food of PRESET_FOODS) {
    expect(Object.isFrozen(food)).toBe(true);
    expect(Object.isFrozen(food.aliases)).toBe(true);
    expect(Object.isFrozen(food.conversionAssumptions)).toBe(true);
  }

  expect(new Set(PRESET_FOODS.map((food) => food.aliases)).size).toBe(33);
  expect(new Set(PRESET_FOODS.map((food) => food.conversionAssumptions)).size).toBe(33);
});

test('预设目录保持 Food[] 和 Food 的对外类型兼容', () => {
  const acceptFoodArray = (foods: Food[]) => foods.length;
  const acceptFood = (food: Food) => food.id;

  expect(acceptFoodArray(PRESET_FOODS)).toBe(33);
  expect(acceptFood(PRESET_FOODS[0])).toBe('food:preset:usda:168878');
  expect(Object.isFrozen(PRESET_FOODS)).toBe(true);
  expect(Object.isFrozen(PRESET_FOODS[0].aliases)).toBe(true);
});

test('manifest 逐字段保留人工审查 provenance 与食物映射', async () => {
  const provenanceUrl = pathToFileURL(
    resolve(REPOSITORY_ROOT, 'scripts/preset-food-image-provenance.mjs'),
  ).href;
  const { PRESET_FOOD_IMAGE_PROVENANCE } = (await import(provenanceUrl)) as {
    PRESET_FOOD_IMAGE_PROVENANCE: readonly Record<string, unknown>[];
  };
  const generatedWithoutHashes = PRESET_FOOD_IMAGE_MANIFEST.map(
    ({ sha256: _sha256, ...row }) => row,
  );

  expect(PRESET_FOOD_IMAGE_PROVENANCE).toEqual(generatedWithoutHashes);
  expect(
    PRESET_FOOD_IMAGE_PROVENANCE.map(
      ({ foodId, path, name, preparation }) => ({ foodId, path, name, preparation }),
    ),
  ).toEqual([
    {
      foodId: 'food:preset:usda:168878',
      path: '/food-presets/rice.webp',
      name: '熟米饭',
      preparation: '蒸煮',
    },
    {
      foodId: 'food:preset:usda:171477',
      path: '/food-presets/chicken-breast.webp',
      name: '熟鸡胸肉',
      preparation: '去皮熟制',
    },
    {
      foodId: 'food:preset:usda:170236',
      path: '/food-presets/lean-beef.webp',
      name: '熟瘦牛肉',
      preparation: '瘦肉熟制',
    },
  ]);
});

test('manifest builder 拒绝未经人工审查的 provenance', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'tiezheng-manifest-review-'));

  try {
    const provenanceUrl = pathToFileURL(
      resolve(REPOSITORY_ROOT, 'scripts/preset-food-image-provenance.mjs'),
    ).href;
    const builderUrl = pathToFileURL(
      resolve(REPOSITORY_ROOT, 'scripts/build-preset-food-image-manifest.mjs'),
    ).href;
    const { PRESET_FOOD_IMAGE_PROVENANCE } = (await import(provenanceUrl)) as {
      PRESET_FOOD_IMAGE_PROVENANCE: readonly Record<string, unknown>[];
    };
    const { buildPresetFoodImageManifest } = (await import(
      /* @vite-ignore */ builderUrl
    )) as {
      buildPresetFoodImageManifest: (options: {
        repositoryRoot: string;
        output: string;
        provenance: readonly Record<string, unknown>[];
      }) => Promise<void>;
    };
    const unreviewed = PRESET_FOOD_IMAGE_PROVENANCE.map((row, index) =>
      index === 0 ? { ...row, reviewed: false } : row,
    );

    await expect(
      buildPresetFoodImageManifest({
        repositoryRoot: REPOSITORY_ROOT,
        output: resolve(temporaryRoot, 'manifest.ts'),
        provenance: unreviewed,
      }),
    ).rejects.toThrow(/reviewed/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('每个食物使用独立真实 WebP，manifest hash 与文件一致', async () => {
  expect(PRESET_FOOD_IMAGE_MANIFEST).toHaveLength(3);
  expect(new Set(PRESET_FOOD_IMAGE_MANIFEST.map((row) => row.path)).size).toBe(3);
  expect(new Set(PRESET_FOOD_IMAGE_MANIFEST.map((row) => row.sha256)).size).toBe(3);

  for (const row of PRESET_FOOD_IMAGE_MANIFEST) {
    const file = resolve(process.cwd(), 'public', row.path.replace(/^\//, ''));
    const bytes = await readFile(file);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(row.sha256);
    expect((await stat(file)).size).toBeLessThanOrEqual(35 * 1024);
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString()).toBe('WEBP');
    expect(await sharp(bytes).metadata()).toMatchObject({
      width: 256,
      height: 256,
      format: 'webp',
    });
    expect(row.reviewed).toBe(true);
    expect(row.generator).toBe('OpenAI imagegen');
  }
});

test('第二个命名源图无法解码时，正式 33 项全部保持不变', async () => {
  const fixture = await assetFixture();
  const sourcePaths = [
    resolve(fixture.sourceDirectory, 'rice.png'),
    resolve(fixture.sourceDirectory, 'chicken-breast.png'),
  ];

  try {
    await Promise.all([
      writeFile(sourcePaths[0], await coloredImage(82, 'png')),
      writeFile(sourcePaths[1], Buffer.from('not-an-image')),
    ]);
    const { preparePresetFoodImages } = await loadAssetPreparationModule();

    await expect(
      preparePresetFoodImages({
        sourcePaths,
        outputDirectory: fixture.outputDirectory,
      }),
    ).rejects.toThrow();
    await expect(readBatch(fixture.outputDirectory)).resolves.toEqual(
      fixture.before,
    );
    await expect(transactionArtifacts(fixture.root)).resolves.toEqual([]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('命名增量批次只替换指定 slug 并保留其他 32 项字节', async () => {
  const fixture = await assetFixture();

  try {
    const { preparePresetFoodImages } = await loadAssetPreparationModule();
    await preparePresetFoodImages({
      sourcePaths: [resolve(fixture.sourceDirectory, 'mantou.png')],
      outputDirectory: fixture.outputDirectory,
    });

    const after = await readBatch(fixture.outputDirectory);
    const mantouIndex = OUTPUT_NAMES.indexOf('mantou.webp');
    expect(after[mantouIndex]).not.toEqual(fixture.before[mantouIndex]);
    for (const name of OUTPUT_NAMES.filter((value) => value !== 'mantou.webp')) {
      const index = OUTPUT_NAMES.indexOf(name);
      expect(after[index]).toEqual(fixture.before[index]);
    }
    await expect(transactionArtifacts(fixture.root)).resolves.toEqual([]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('并发非重叠增量只能一个持锁成功，顺序重试后两项更新可组合', async () => {
  const fixture = await assetFixture();
  const requests = [
    { name: 'mantou.webp', source: 'mantou.png' },
    { name: 'tuna.webp', source: 'tuna.png' },
  ] as const;

  try {
    const { preparePresetFoodImages } = await loadAssetPreparationModule();
    const results = await Promise.allSettled(
      requests.map((request) =>
        preparePresetFoodImages({
          sourcePaths: [resolve(fixture.sourceDirectory, request.source)],
          outputDirectory: fixture.outputDirectory,
        }),
      ),
    );
    const fulfilledIndexes = results.flatMap((result, index) =>
      result.status === 'fulfilled' ? [index] : [],
    );
    const rejectedIndexes = results.flatMap((result, index) =>
      result.status === 'rejected' ? [index] : [],
    );

    expect(fulfilledIndexes).toHaveLength(1);
    expect(rejectedIndexes).toHaveLength(1);
    const rejectedResult = results[rejectedIndexes[0]];
    expect(rejectedResult).toMatchObject({ status: 'rejected' });
    expect(
      rejectedResult.status === 'rejected'
        ? String(rejectedResult.reason)
        : '',
    ).toContain('already in progress');

    const afterFirst = await readBatch(fixture.outputDirectory);
    const fulfilledName = requests[fulfilledIndexes[0]].name;
    const rejectedName = requests[rejectedIndexes[0]].name;
    expect(afterFirst[OUTPUT_NAMES.indexOf(fulfilledName)]).not.toEqual(
      fixture.before[OUTPUT_NAMES.indexOf(fulfilledName)],
    );
    expect(afterFirst[OUTPUT_NAMES.indexOf(rejectedName)]).toEqual(
      fixture.before[OUTPUT_NAMES.indexOf(rejectedName)],
    );
    await expect(transactionArtifacts(fixture.root)).resolves.toEqual([]);

    await preparePresetFoodImages({
      sourcePaths: [
        resolve(
          fixture.sourceDirectory,
          requests[rejectedIndexes[0]].source,
        ),
      ],
      outputDirectory: fixture.outputDirectory,
    });

    const afterRetry = await readBatch(fixture.outputDirectory);
    for (const request of requests) {
      const index = OUTPUT_NAMES.indexOf(request.name);
      expect(afterRetry[index]).not.toEqual(fixture.before[index]);
    }
    for (const name of OUTPUT_NAMES.filter(
      (value) => !requests.some((request) => request.name === value),
    )) {
      const index = OUTPUT_NAMES.indexOf(name);
      expect(afterRetry[index]).toEqual(fixture.before[index]);
    }
    await expect(transactionArtifacts(fixture.root)).resolves.toEqual([]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('预建 stale lock 时 fail closed 并返回人工恢复路径', async () => {
  const fixture = await assetFixture();
  const lockDirectory = resolve(fixture.root, '.food-presets.lock');

  try {
    await mkdir(lockDirectory);
    const { preparePresetFoodImages } = await loadAssetPreparationModule();
    let caught: unknown;

    try {
      await preparePresetFoodImages({
        sourcePaths: [resolve(fixture.sourceDirectory, 'mantou.png')],
        outputDirectory: fixture.outputDirectory,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('already in progress');
    expect((caught as Error).message).toContain(lockDirectory);
    await expect(readBatch(fixture.outputDirectory)).resolves.toEqual(
      fixture.before,
    );
    await expect(transactionArtifacts(fixture.root)).resolves.toEqual([
      '.food-presets.lock',
    ]);

    await rm(lockDirectory, { recursive: true, force: false });
    await expect(transactionArtifacts(fixture.root)).resolves.toEqual([]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('完整 33 图可初始化尚不存在的嵌套 output parent 并清理 lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tiezheng-food-assets-new-parent-'));
  const sourceDirectory = resolve(root, 'sources');
  const outputParent = resolve(root, 'nested/assets');
  const outputDirectory = resolve(outputParent, 'food-presets');

  try {
    await mkdir(sourceDirectory, { recursive: true });
    const sourcePaths = await Promise.all(
      OUTPUT_NAMES.map(async (name, index) => {
        const sourcePath = resolve(
          sourceDirectory,
          `${name.slice(0, -'.webp'.length)}.png`,
        );
        await writeFile(sourcePath, await coloredImage(index + 160, 'png'));
        return sourcePath;
      }),
    );
    const { preparePresetFoodImages } = await loadAssetPreparationModule();

    await preparePresetFoodImages({ sourcePaths, outputDirectory });

    const encoded = await readBatch(outputDirectory);
    expect(encoded).toHaveLength(33);
    expect(
      new Set(
        encoded.map((bytes) =>
          createHash('sha256').update(bytes).digest('hex'),
        ),
      ).size,
    ).toBe(33);
    await expect(transactionArtifacts(outputParent)).resolves.toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('未知源图 slug 在目录交换前失败且原 33 项保持不变', async () => {
  const fixture = await assetFixture();

  try {
    const { preparePresetFoodImages } = await loadAssetPreparationModule();
    await expect(
      preparePresetFoodImages({
        sourcePaths: [resolve(fixture.sourceDirectory, 'bao-bun.png')],
        outputDirectory: fixture.outputDirectory,
      }),
    ).rejects.toThrow('unknown preset image slug: bao-bun');
    await expect(readBatch(fixture.outputDirectory)).resolves.toEqual(
      fixture.before,
    );
    await expect(transactionArtifacts(fixture.root)).resolves.toEqual([]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('增量更新在 omitted 旧资产不是 WebP 时 fail closed 并保持不变', async () => {
  const fixture = await assetFixture();
  const invalidName = 'rice.webp';

  try {
    await writeFile(
      resolve(fixture.outputDirectory, invalidName),
      Buffer.from('not-webp'),
    );
    const before = await readBatch(fixture.outputDirectory);
    const { preparePresetFoodImages } = await loadAssetPreparationModule();

    await expect(
      preparePresetFoodImages({
        sourcePaths: [resolve(fixture.sourceDirectory, 'mantou.png')],
        outputDirectory: fixture.outputDirectory,
      }),
    ).rejects.toThrow(`invalid existing preset image: ${invalidName}`);
    await expect(readBatch(fixture.outputDirectory)).resolves.toEqual(before);
    await expect(transactionArtifacts(fixture.root)).resolves.toEqual([]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('增量更新在 omitted 旧资产不是 256×256 WebP 时 fail closed 并保持不变', async () => {
  const fixture = await assetFixture();
  const invalidName = 'rice.webp';

  try {
    const wrongSizeWebp = await sharp({
      create: {
        width: 128,
        height: 256,
        channels: 4,
        background: { r: 22, g: 44, b: 66, alpha: 1 },
      },
    })
      .webp()
      .toBuffer();
    await writeFile(resolve(fixture.outputDirectory, invalidName), wrongSizeWebp);
    const before = await readBatch(fixture.outputDirectory);
    const { preparePresetFoodImages } = await loadAssetPreparationModule();

    await expect(
      preparePresetFoodImages({
        sourcePaths: [resolve(fixture.sourceDirectory, 'mantou.png')],
        outputDirectory: fixture.outputDirectory,
      }),
    ).rejects.toThrow(`invalid existing preset image: ${invalidName}`);
    await expect(readBatch(fixture.outputDirectory)).resolves.toEqual(before);
    await expect(transactionArtifacts(fixture.root)).resolves.toEqual([]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('增量批次提交第二次 rename 失败时恢复原 33 项目录', async () => {
  const fixture = await assetFixture();
  let renameCalls = 0;
  const failSecondRename = async (from: string, to: string) => {
    renameCalls += 1;
    if (renameCalls === 2) {
      throw new Error('simulated commit rename failure');
    }
    await renamePath(from, to);
  };
  const encodedFiles = await Promise.all(
    OUTPUT_NAMES.map(async (name, index) => ({
      name,
      bytes: await coloredImage(index + 100, 'webp'),
    })),
  );

  try {
    const { replacePresetFoodOutputDirectory } = await loadAssetPreparationModule();
    await expect(
      replacePresetFoodOutputDirectory({
        outputDirectory: fixture.outputDirectory,
        encodedFiles,
        expectedOutputNames: OUTPUT_NAMES,
        operationId: 'rollback-check',
        fileOps: { rename: failSecondRename },
      }),
    ).rejects.toThrow('simulated commit rename failure');
    await expect(readBatch(fixture.outputDirectory)).resolves.toEqual(
      fixture.before,
    );
    await expect(transactionArtifacts(fixture.root)).resolves.toEqual([]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test.each([
  {
    label: '数量不等',
    encodedFiles: encodedBatch(byteBatch('replacement')).slice(0, -1),
    expectedMessage: 'encoded preset file count must match expected output names',
  },
  {
    label: '包含未知名称并缺失正式名称',
    encodedFiles: encodedBatch(byteBatch('replacement')).map((row, index) =>
      index === OUTPUT_NAMES.length - 1
        ? { ...row, name: 'bao-bun.webp' }
        : row,
    ),
    expectedMessage: 'unknown encoded preset image name: bao-bun.webp',
  },
  {
    label: '包含重复名称并缺失正式名称',
    encodedFiles: encodedBatch(byteBatch('replacement')).map((row, index) =>
      index === OUTPUT_NAMES.length - 1
        ? { ...row, name: OUTPUT_NAMES[0] }
        : row,
    ),
    expectedMessage: `duplicate encoded preset image name: ${OUTPUT_NAMES[0]}`,
  },
])('encodedFiles $label时在创建 staging 前 fail closed', async ({
  encodedFiles,
  expectedMessage,
}) => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'tiezheng-swap-validation-'));
  const outputDirectory = resolve(parentDirectory, 'food-presets');
  const sentinels = byteBatch('sentinel');
  let renameCalls = 0;

  try {
    await writeBatch(outputDirectory, sentinels);
    const { replacePresetFoodOutputDirectory } = await loadAssetPreparationModule();

    await expect(
      replacePresetFoodOutputDirectory({
        outputDirectory,
        encodedFiles,
        expectedOutputNames: OUTPUT_NAMES,
        operationId: 'validation-fails-closed',
        fileOps: {
          rename: async (oldPath, newPath) => {
            renameCalls += 1;
            await renamePath(oldPath, newPath);
          },
        },
      }),
    ).rejects.toThrow(expectedMessage);

    expect(renameCalls).toBe(0);
    await expect(readBatch(outputDirectory)).resolves.toEqual(sentinels);
    await expect(transactionArtifacts(parentDirectory)).resolves.toEqual([]);
  } finally {
    await rm(parentDirectory, { recursive: true, force: true });
  }
});

test('expectedOutputNames 拒绝路径穿越、绝对路径和非 canonical 名称', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'tiezheng-swap-path-safety-'));
  const outputDirectory = resolve(parentDirectory, 'food-presets');
  const sentinels = byteBatch('sentinel');
  const invalidNames = [
    '../escape.webp',
    resolve(parentDirectory, 'absolute-escape.webp'),
    'bao-bun.webp',
  ];

  try {
    await writeBatch(outputDirectory, sentinels);
    const { replacePresetFoodOutputDirectory } = await loadAssetPreparationModule();

    for (const [index, invalidName] of invalidNames.entries()) {
      const expectedOutputNames = OUTPUT_NAMES.map((name, nameIndex) =>
        nameIndex === OUTPUT_NAMES.length - 1 ? invalidName : name,
      );
      const encodedFiles = encodedBatch(byteBatch(`replacement-${index}`)).map(
        (row, rowIndex) =>
          rowIndex === OUTPUT_NAMES.length - 1
            ? { ...row, name: invalidName }
            : row,
      );
      let renameCalls = 0;

      await expect(
        replacePresetFoodOutputDirectory({
          outputDirectory,
          encodedFiles,
          expectedOutputNames,
          operationId: `path-safety-${index}`,
          fileOps: {
            rename: async () => {
              renameCalls += 1;
              throw new Error('rename must not run for invalid expected names');
            },
          },
        }),
      ).rejects.toThrow(`unknown expected preset output name: ${invalidName}`);
      expect(renameCalls).toBe(0);
      await expect(readBatch(outputDirectory)).resolves.toEqual(sentinels);
      await expect(transactionArtifacts(parentDirectory)).resolves.toEqual([]);
    }

    await expect(stat(resolve(parentDirectory, 'escape.webp'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      stat(resolve(parentDirectory, 'absolute-escape.webp')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(parentDirectory, { recursive: true, force: true });
  }
});

test('staging 提交失败时从 backup 恢复原 33 项并清理事务目录', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'tiezheng-swap-rollback-'));
  const outputDirectory = resolve(parentDirectory, 'food-presets');
  const operationId = 'rollback-restores-original';
  const stagingDirectory = resolve(
    parentDirectory,
    `.food-presets.staging-${operationId}`,
  );
  const sentinels = byteBatch('sentinel');
  const replacements = byteBatch('replacement');
  const commitError = new Error('injected staging commit failure');

  try {
    await writeBatch(outputDirectory, sentinels);
    const { replacePresetFoodOutputDirectory } = await loadAssetPreparationModule();

    await expect(
      replacePresetFoodOutputDirectory({
        outputDirectory,
        encodedFiles: encodedBatch(replacements),
        expectedOutputNames: OUTPUT_NAMES,
        operationId,
        fileOps: {
          rename: async (oldPath, newPath) => {
            if (
              resolve(oldPath) === stagingDirectory &&
              resolve(newPath) === outputDirectory
            ) {
              throw commitError;
            }
            await renamePath(oldPath, newPath);
          },
        },
      }),
    ).rejects.toBe(commitError);

    await expect(readBatch(outputDirectory)).resolves.toEqual(sentinels);
    await expect(transactionArtifacts(parentDirectory)).resolves.toEqual([]);
  } finally {
    await rm(parentDirectory, { recursive: true, force: true });
  }
});

test('staging 提交和 backup 恢复均失败时保留完整 backup 并抛出双重错误', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'tiezheng-swap-double-'));
  const outputDirectory = resolve(parentDirectory, 'food-presets');
  const operationId = 'double-failure';
  const stagingDirectory = resolve(
    parentDirectory,
    `.food-presets.staging-${operationId}`,
  );
  const backupDirectory = resolve(
    parentDirectory,
    `.food-presets.backup-${operationId}`,
  );
  const sentinels = byteBatch('sentinel');
  const replacements = byteBatch('replacement');
  const commitError = new Error('injected staging commit failure');
  const rollbackError = new Error('injected backup restore failure');

  try {
    await writeBatch(outputDirectory, sentinels);
    const { replacePresetFoodOutputDirectory } = await loadAssetPreparationModule();
    let caught: unknown;

    try {
      await replacePresetFoodOutputDirectory({
        outputDirectory,
        encodedFiles: encodedBatch(replacements),
        expectedOutputNames: OUTPUT_NAMES,
        operationId,
        fileOps: {
          rename: async (oldPath, newPath) => {
            if (
              resolve(oldPath) === stagingDirectory &&
              resolve(newPath) === outputDirectory
            ) {
              throw commitError;
            }
            if (
              resolve(oldPath) === backupDirectory &&
              resolve(newPath) === outputDirectory
            ) {
              throw rollbackError;
            }
            await renamePath(oldPath, newPath);
          },
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([commitError, rollbackError]);
    await expect(readBatch(backupDirectory)).resolves.toEqual(sentinels);
    await expect(stat(stagingDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(transactionArtifacts(parentDirectory)).resolves.toEqual([
      `.food-presets.backup-${operationId}`,
    ]);
  } finally {
    await rm(parentDirectory, { recursive: true, force: true });
  }
});

test('成功 swap 整批替换 33 项且不留 staging 或 backup', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'tiezheng-swap-success-'));
  const outputDirectory = resolve(parentDirectory, 'food-presets');
  const sentinels = byteBatch('sentinel');
  const replacements = byteBatch('replacement');

  try {
    await writeBatch(outputDirectory, sentinels);
    const { replacePresetFoodOutputDirectory } = await loadAssetPreparationModule();

    await replacePresetFoodOutputDirectory({
      outputDirectory,
      encodedFiles: encodedBatch(replacements).reverse(),
      expectedOutputNames: OUTPUT_NAMES,
      operationId: 'successful-swap',
    });

    await expect(readBatch(outputDirectory)).resolves.toEqual(replacements);
    await expect(transactionArtifacts(parentDirectory)).resolves.toEqual([]);
  } finally {
    await rm(parentDirectory, { recursive: true, force: true });
  }
});

test('backup 清理失败时明确报告新批次已提交并保留原 backup', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'tiezheng-swap-cleanup-'));
  const outputDirectory = resolve(parentDirectory, 'food-presets');
  const operationId = 'cleanup-failure';
  const backupDirectory = resolve(
    parentDirectory,
    `.food-presets.backup-${operationId}`,
  );
  const sentinels = byteBatch('sentinel');
  const replacements = byteBatch('replacement');
  const cleanupError = new Error('injected backup cleanup failure');

  try {
    await writeBatch(outputDirectory, sentinels);
    const { replacePresetFoodOutputDirectory } = await loadAssetPreparationModule();
    let caught: unknown;

    try {
      await replacePresetFoodOutputDirectory({
        outputDirectory,
        encodedFiles: encodedBatch(replacements),
        expectedOutputNames: OUTPUT_NAMES,
        operationId,
        fileOps: {
          remove: async (path, options) => {
            if (resolve(path) === backupDirectory) {
              throw cleanupError;
            }
            await rm(path, options);
          },
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as Error).message).toMatch(/committed.*backup cleanup failed/i);
    expect((caught as AggregateError).errors).toEqual([cleanupError]);
    await expect(readBatch(outputDirectory)).resolves.toEqual(replacements);
    await expect(readBatch(backupDirectory)).resolves.toEqual(sentinels);
  } finally {
    await rm(parentDirectory, { recursive: true, force: true });
  }
});

test('资产脚本默认仓库根目录不依赖当前工作目录', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'tiezheng-script-cwd-'));
  const originalCwd = process.cwd();
  const cacheBuster = `review=${Date.now()}`;
  const prepareUrl = `${pathToFileURL(
    resolve(REPOSITORY_ROOT, 'scripts/prepare-preset-food-images.mjs'),
  ).href}?${cacheBuster}`;
  const manifestUrl = `${pathToFileURL(
    resolve(REPOSITORY_ROOT, 'scripts/build-preset-food-image-manifest.mjs'),
  ).href}?${cacheBuster}`;

  try {
    process.chdir(temporaryRoot);
    const [prepareModule, manifestModule] = (await Promise.all([
      import(/* @vite-ignore */ prepareUrl),
      import(/* @vite-ignore */ manifestUrl),
    ])) as Array<{ DEFAULT_REPOSITORY_ROOT: string }>;

    expect(prepareModule.DEFAULT_REPOSITORY_ROOT).toBe(REPOSITORY_ROOT);
    expect(manifestModule.DEFAULT_REPOSITORY_ROOT).toBe(REPOSITORY_ROOT);
  } finally {
    process.chdir(originalCwd);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
