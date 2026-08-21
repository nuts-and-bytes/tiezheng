# 铁证 33 种基础食物目录与图片资产 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有 3 项本地食物目录扩充为 33 项可追溯基础食物，并为每项提供经过人工审核的 256×256 WebP 本地图片，同时保留现有三张图片和离线手动录入能力。

**Architecture:** `src/data/presetFoods.ts` 继续作为唯一运行时目录，通过现有 `normalizeFoodNutrients()` 从原始基准生成统一营养值；32 项使用 USDA FoodData Central，馒头使用国家卫生健康委公开指南中的 150 g 原始份量。合法图片文件名由独立的 33 项输出名常量锁定，图片来源、提示词和人工审核记录保存在 provenance；准备脚本按文件 slug 支持 1–33 张增量输入，在一次原子目录交换中合并新图与未改动旧图，manifest 再锁定尺寸、大小和 SHA-256。

**Tech Stack:** TypeScript 5.8 strict、React 19、Vitest 3、Testing Library、Node.js ESM、Sharp 0.33.5、OpenAI imagegen、本地静态 WebP。

---

## 范围、前置条件与停止条件

- 规格来源：`docs/superpowers/specs/2026-08-21-tiezheng-food-catalog-and-text-ai-design.md`。
- 本计划只完成 Ticket A；不创建文字 AI 入口、请求契约或网关路由。
- 保留现有 `rice.webp`、`chicken-breast.webp`、`lean-beef.webp` 的字节和 provenance。
- “馒头”固定保留为目录第 26 项，图片语义固定为无馅白馒头，不用豆沙包、肉包或花卷替代。
- USDA SR Legacy 与 FNDDS 数据使用 FoodData Central 官方下载快照；许可记录为 `CC0 1.0`。
- 馒头使用国家卫生健康委《成人肌少症食养指南（2026年版）》表 2.9：原始基准 `150 g = 335 kcal, 10 g protein`；归一化结果必须为 `223.333333333333 kcal/100 g` 和 `6.666666666667 g protein/100 g`。
- 任一图片无法通过“单一食物、状态一致、无包装文字、无第二种食物”审核时，重新生成该图片；不得把 `reviewed` 改为 `true` 以绕过 manifest 门禁。

## File map

### Modified files

- `src/data/presetFoods.ts`：33 项权威目录、来源元数据和归一化。
- `src/data/presetFoods.test.ts`：目录快照、来源、营养复算、资产原子更新和 manifest 对应测试。
- `src/lib/photoAiContract.ts`：目录内容变化后把照片 AI 目录版本提升到 `tiezheng-food-catalog-v2`。
- `src/lib/photoAiContract.test.ts`：锁定目录版本并验证旧响应被拒绝。
- `scripts/prepare-preset-food-images.mjs`：按 slug 接受 1–33 个源图，并与现有正式资产原子合并。
- `scripts/preset-food-image-provenance.mjs`：33 项图片提示词、路径和人工审核记录。
- `scripts/build-preset-food-image-manifest.mjs`：按 provenance 动态校验 33 项资产。
- `src/data/presetFoodImageManifest.generated.ts`：由 manifest 命令重建，不手工编辑。
- `src/screens/health/FoodPickerSheet.test.tsx`：33 张图片、无占位符和搜索回归。

### New source file

- `scripts/preset-food-image-output-names.mjs`：准备脚本可接受的 33 个稳定输出文件名；provenance 测试必须证明两者集合一致。

### New binary files

- `public/food-presets/oatmeal-porridge.webp`
- `public/food-presets/whole-wheat-bread.webp`
- `public/food-presets/sweet-potato.webp`
- `public/food-presets/sweet-corn.webp`
- `public/food-presets/boiled-potato.webp`
- `public/food-presets/chicken-thigh.webp`
- `public/food-presets/pork-tenderloin.webp`
- `public/food-presets/salmon.webp`
- `public/food-presets/shrimp.webp`
- `public/food-presets/boiled-egg.webp`
- `public/food-presets/firm-tofu.webp`
- `public/food-presets/whole-milk.webp`
- `public/food-presets/plain-yogurt.webp`
- `public/food-presets/broccoli.webp`
- `public/food-presets/spinach.webp`
- `public/food-presets/tomato.webp`
- `public/food-presets/cucumber.webp`
- `public/food-presets/carrot.webp`
- `public/food-presets/apple.webp`
- `public/food-presets/banana.webp`
- `public/food-presets/orange.webp`
- `public/food-presets/cooked-noodles.webp`
- `public/food-presets/mantou.webp`
- `public/food-presets/tuna.webp`
- `public/food-presets/cod.webp`
- `public/food-presets/unsweetened-soy-milk.webp`
- `public/food-presets/leaf-lettuce.webp`
- `public/food-presets/cabbage.webp`
- `public/food-presets/shiitake.webp`
- `public/food-presets/strawberry.webp`

## 权威目录快照

以下顺序、ID 和数值同时用于实现与测试：

| # | ID / 来源 | 名称 | 状态与处理 | kcal/100 g | 蛋白质 g/100 g |
| --- | --- | --- | --- | ---: | ---: |
| 1 | USDA 168878 SR Legacy | 熟米饭 | 清水蒸煮 | 130 | 2.69 |
| 2 | USDA 171477 SR Legacy | 熟鸡胸肉 | 去皮熟制 | 165 | 31 |
| 3 | USDA 170236 SR Legacy | 熟瘦牛肉 | 瘦肉熟制 | 190 | 36.1 |
| 4 | USDA 173905 SR Legacy | 熟燕麦粥 | 清水煮熟 | 71 | 2.54 |
| 5 | USDA 172688 SR Legacy | 全麦面包 | 原味即食 | 252 | 12.4 |
| 6 | USDA 168483 SR Legacy | 熟红薯 | 烘烤熟制，无添加 | 90 | 2.01 |
| 7 | USDA 169999 SR Legacy | 熟玉米 | 水煮沥干，无盐 | 96 | 3.41 |
| 8 | USDA 170440 SR Legacy | 熟土豆 | 去皮水煮，无盐 | 86 | 1.71 |
| 9 | USDA 172388 SR Legacy | 熟鸡腿肉 | 去皮烤制 | 179 | 24.8 |
| 10 | USDA 168250 SR Legacy | 熟猪里脊 | 瘦肉烤制 | 143 | 26.2 |
| 11 | USDA 175168 SR Legacy | 熟三文鱼 | 大西洋养殖三文鱼干热熟制 | 206 | 22.1 |
| 12 | USDA 171971 SR Legacy | 熟虾仁 | 湿热熟制 | 119 | 22.8 |
| 13 | USDA 173424 SR Legacy | 水煮蛋 | 全蛋水煮 | 155 | 12.6 |
| 14 | USDA 172475 SR Legacy | 北豆腐 | 硫酸钙凝固硬豆腐 | 144 | 17.3 |
| 15 | USDA 171265 SR Legacy | 纯牛奶 | 全脂 3.25%，无糖 | 61 | 3.15 |
| 16 | USDA 171284 SR Legacy | 原味酸奶 | 全脂原味，无糖 | 61 | 3.47 |
| 17 | USDA 169967 SR Legacy | 西兰花 | 水煮沥干，无盐 | 35 | 2.38 |
| 18 | USDA 168463 SR Legacy | 菠菜 | 水煮沥干，无盐 | 23 | 2.97 |
| 19 | USDA 170457 SR Legacy | 番茄 | 生食 | 18 | 0.88 |
| 20 | USDA 168409 SR Legacy | 黄瓜 | 带皮生食 | 15 | 0.65 |
| 21 | USDA 170393 SR Legacy | 胡萝卜 | 生食 | 41 | 0.93 |
| 22 | USDA 171688 SR Legacy | 苹果 | 带皮生食 | 52 | 0.26 |
| 23 | USDA 173944 SR Legacy | 香蕉 | 去皮生食 | 89 | 1.09 |
| 24 | USDA 169097 SR Legacy | 橙子 | 去皮生食 | 47 | 0.94 |
| 25 | USDA 2708352 Survey (FNDDS) | 熟面条 | 清水煮熟，沥干 | 137 | 4.51 |
| 26 | NHC 2026 表 2.9 | 馒头 | 原味无馅蒸制 | 223.333333333333 | 6.666666666667 |
| 27 | USDA 171986 SR Legacy | 金枪鱼 | 水浸罐头、沥干、无盐 | 116 | 25.5 |
| 28 | USDA 171956 SR Legacy | 鳕鱼 | 大西洋鳕鱼干热熟制 | 105 | 22.8 |
| 29 | USDA 175215 SR Legacy | 无糖豆浆 | 无糖强化豆浆 | 33 | 2.86 |
| 30 | USDA 169249 SR Legacy | 生菜 | 绿叶生菜生食 | 15 | 1.36 |
| 31 | USDA 169975 SR Legacy | 卷心菜 | 生食 | 25 | 1.28 |
| 32 | USDA 168437 SR Legacy | 香菇 | 熟制，无盐 | 56 | 1.56 |
| 33 | USDA 167762 SR Legacy | 草莓 | 生食 | 32 | 0.67 |

### Task 1: 用失败快照锁定 33 项目录与馒头原始基准

**Files:**
- Modify: `src/data/presetFoods.test.ts`
- Test: `src/data/presetFoods.test.ts`

- [ ] **Step 1: 把目录期望写成测试常量**

在测试文件中增加完整快照；它同时阻止漏项、调序、误用豆沙包数据和静默改营养值：

```ts
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

test('目录固定为 33 种基础食物并保留馒头', () => {
  expect(PRESET_FOODS.map((food) => [
    food.fdcId,
    food.fdcDataType,
    food.name,
    food.energyKcal,
    food.proteinG,
  ])).toEqual(EXPECTED_CATALOG);
  expect(new Set(PRESET_FOODS.map((food) => food.id)).size).toBe(33);
  expect(new Set(PRESET_FOODS.map((food) => food.name)).size).toBe(33);
});

test('馒头保留国家卫健委 150 g 原始基准并可无损复算', () => {
  const mantou = PRESET_FOODS.find((food) => food.name === '馒头');
  expect(mantou).toMatchObject({
    id: 'food:preset:nhc:adult-sarcopenia-2026:mantou',
    fdcId: null,
    fdcDataType: null,
    originalEnergyValue: 335,
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
```

- [ ] **Step 2: 运行测试并确认因目录仍为 3 项而失败**

Run: `npm test -- src/data/presetFoods.test.ts`

Expected: FAIL；目录快照实际只有 3 行，且找不到名称为“馒头”的条目。

- [ ] **Step 3: 提交仅含失败测试的红灯检查点**

```bash
git add src/data/presetFoods.test.ts
git commit -m "test: lock 33 preset food catalog"
```

### Task 2: 实现 33 项权威目录和来源归一化

**Files:**
- Modify: `src/data/presetFoods.ts`
- Test: `src/data/presetFoods.test.ts`

- [ ] **Step 1: 用统一 seed 类型替换当前只支持 SR Legacy 的 helper**

在 `presetFoods.ts` 导入归一化函数，并使用以下类型和构造函数：

```ts
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
    sourceVersion: fdcDataType === 'SR Legacy'
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
```

- [ ] **Step 2: 写入完整 seed 数组，保持馒头为第 26 项**

```ts
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
```

- [ ] **Step 3: 增加逐项归一化复算断言并更新目录长度断言**

```ts
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
```

把同文件中深冻结数组、别名数组和 `Food[]` 类型兼容测试里的期望长度从 `3` 改为 `33`；图片 provenance 与 generated manifest 在 Task 5 前仍共同保持 3 项，因此此时不要提前把真实资产长度断言改为 33。

- [ ] **Step 4: 提升照片 AI 的目录版本**

`workers/photo-ai-gateway/src/doubaoAdapter.ts` 会直接把 `PRESET_FOODS` 作为目录提示发送给模型，因此目录内容变化必须使旧响应和旧幂等缓存失效。在 `src/lib/photoAiContract.ts` 修改：

```ts
export const PHOTO_AI_VERSIONS = Object.freeze({
  model: 'doubao-seed-2-1-pro-260628',
  prompt: 'tiezheng-food-photo-zh-v1',
  schema: 'tiezheng-photo-estimate-v1',
  catalog: 'tiezheng-food-catalog-v2',
  transform: 'tiezheng-photo-webp-v1',
  uncertainty: 'tiezheng-photo-uncertainty-v1',
  providerPolicy: 'volcengine-ark-policy-2026-08-18',
} as const);
```

更新 `src/lib/photoAiContract.test.ts` 的固定版本快照，并增加一个把成功 fixture 的 catalog 改回 `tiezheng-food-catalog-v1` 后应抛出 `Invalid photo AI response` 的测试。

- [ ] **Step 5: 运行目录、照片契约和仓储回归**

Run: `npm test -- src/data/presetFoods.test.ts src/lib/photoAiContract.test.ts src/repos/foodRepo.test.ts`

Expected: 全部 PASS；此时真实图片 provenance 与 generated manifest 仍都是现有 3 项，尚未声称 33 张资产完成。

- [ ] **Step 6: 提交目录实现**

```bash
git add src/data/presetFoods.ts src/data/presetFoods.test.ts src/lib/photoAiContract.ts src/lib/photoAiContract.test.ts
git commit -m "feat: expand preset food catalog to 33 items"
```

### Task 3: 让图片准备脚本安全支持命名增量批次

**Files:**
- Create: `scripts/preset-food-image-output-names.mjs`
- Modify: `scripts/prepare-preset-food-images.mjs`
- Modify: `src/data/presetFoods.test.ts`
- Test: `src/data/presetFoods.test.ts`

- [ ] **Step 1: 先写三类失败测试**

测试必须覆盖：只更新一个 slug 时其他 32 项字节不变；未知 slug 在写正式目录前拒绝；第二次 rename 失败时恢复原完整目录。测试夹具使用 33 个不同颜色的 256×256 WebP，并为输入另建 PNG：

```ts
import { PRESET_FOOD_IMAGE_OUTPUT_NAMES as OUTPUT_NAMES } from '../../scripts/preset-food-image-output-names.mjs';

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
  if (values.length !== names.length) throw new Error('fixture length mismatch');
  await mkdir(directory, { recursive: true });
  await Promise.all(
    names.map((name, index) => writeFile(resolve(directory, name), values[index])),
  );
}

async function readBatch(
  directory: string,
  names: readonly string[] = OUTPUT_NAMES,
) {
  return Promise.all(names.map((name) => readFile(resolve(directory, name))));
}

async function coloredImage(index: number, format: 'png' | 'webp'): Promise<Buffer> {
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
  await Promise.all(OUTPUT_NAMES.map(async (name, index) =>
    writeFile(resolve(outputDirectory, name), await coloredImage(index + 1, 'webp')),
  ));
  await writeFile(resolve(sourceDirectory, 'mantou.png'), await coloredImage(80, 'png'));
  await writeFile(resolve(sourceDirectory, 'bao-bun.png'), await coloredImage(81, 'png'));
  return {
    root,
    sourceDirectory,
    outputDirectory,
    before: await readBatch(outputDirectory, OUTPUT_NAMES),
  };
}

test('命名增量批次只替换指定 slug 并保留其他 32 项字节', async () => {
  const fixture = await assetFixture();
  try {
    await preparePresetFoodImages({
      sourcePaths: [resolve(fixture.sourceDirectory, 'mantou.png')],
      outputDirectory: fixture.outputDirectory,
    });
    const after = await readBatch(fixture.outputDirectory, OUTPUT_NAMES);
    expect(after[OUTPUT_NAMES.indexOf('mantou.webp')]).not.toEqual(
      fixture.before[OUTPUT_NAMES.indexOf('mantou.webp')],
    );
    for (const name of OUTPUT_NAMES.filter((value) => value !== 'mantou.webp')) {
      expect(after[OUTPUT_NAMES.indexOf(name)]).toEqual(
        fixture.before[OUTPUT_NAMES.indexOf(name)],
      );
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('未知源图 slug 在目录交换前失败', async () => {
  const fixture = await assetFixture();
  try {
    await expect(preparePresetFoodImages({
      sourcePaths: [resolve(fixture.sourceDirectory, 'bao-bun.png')],
      outputDirectory: fixture.outputDirectory,
    })).rejects.toThrow('unknown preset image slug: bao-bun');
    expect(await readBatch(fixture.outputDirectory, OUTPUT_NAMES)).toEqual(fixture.before);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('增量批次提交 rename 失败时恢复原 33 项目录', async () => {
  const fixture = await assetFixture();
  let renameCalls = 0;
  const failSecondRename = async (from: string, to: string) => {
    renameCalls += 1;
    if (renameCalls === 2) throw new Error('simulated commit rename failure');
    await renamePath(from, to);
  };
  const encodedFiles = await Promise.all(OUTPUT_NAMES.map(async (name, index) => ({
    name,
    bytes: await coloredImage(index + 100, 'webp'),
  })));
  try {
    await expect(replacePresetFoodOutputDirectory({
      outputDirectory: fixture.outputDirectory,
      encodedFiles,
      expectedOutputNames: OUTPUT_NAMES,
      operationId: 'rollback-check',
      fileOps: { rename: failSecondRename },
    })).rejects.toThrow('simulated commit rename failure');
    expect(await readBatch(fixture.outputDirectory, OUTPUT_NAMES)).toEqual(fixture.before);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
```

删除测试文件原来的三项 `OUTPUT_NAMES`、`writeBatch()`、`readBatch()` 和旧的
`ReplacePresetFoodOutputDirectory` 类型。已有 swap/rollback/cleanup 测试中的三项
`sentinels`、`replacements` 统一改为 `byteBatch('sentinel')`、
`byteBatch('replacement')`；传给 `replacePresetFoodOutputDirectory()` 时统一写成
`encodedFiles: encodedBatch(replacements)` 并传入
`expectedOutputNames: OUTPUT_NAMES`。这样旧事务语义继续受测，但不再暗中依赖三文件位置顺序。

- [ ] **Step 2: 运行脚本测试并确认旧的三图固定批次契约失败**

Run: `npm test -- src/data/presetFoods.test.ts`

Expected: FAIL，错误包含 `must contain exactly three` 或增量参数形状不匹配。

- [ ] **Step 3: 建立与图片内容无关的 33 项合法输出名**

创建以下完整模块，使准备脚本在 provenance 尚处于“未审核”状态时也能安全处理 33 项测试夹具：

```js
export const PRESET_FOOD_IMAGE_OUTPUT_NAMES = Object.freeze([
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
]);
```

- [ ] **Step 4: 按输出名实现增量合并**

在准备脚本顶部导入该模块，并以以下规则取代固定三项 `OUTPUT_NAMES`：

```js
import { extname, basename, dirname, resolve } from 'node:path';
import { PRESET_FOOD_IMAGE_OUTPUT_NAMES } from './preset-food-image-output-names.mjs';

const OUTPUT_NAMES = PRESET_FOOD_IMAGE_OUTPUT_NAMES;
const OUTPUT_NAME_SET = new Set(OUTPUT_NAMES);

function targetName(sourcePath) {
  const slug = basename(sourcePath, extname(sourcePath));
  const name = `${slug}.webp`;
  if (!OUTPUT_NAME_SET.has(name)) throw new Error(`unknown preset image slug: ${slug}`);
  return name;
}

async function existingEncodedFiles(outputDirectory, omittedNames) {
  const rows = new Map();
  for (const name of omittedNames) {
    const bytes = await readFile(resolve(outputDirectory, name));
    if (bytes.length === 0 || bytes.length > MAX_BYTES) {
      throw new Error(`invalid existing preset image: ${name}`);
    }
    rows.set(name, bytes);
  }
  return rows;
}
```

`preparePresetFoodImages()` 必须执行以下完整顺序：

```js
export async function preparePresetFoodImages({
  sourcePaths,
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY,
}) {
  const resolvedSourcePaths = sourcePaths.map((value) => resolve(value));
  if (resolvedSourcePaths.length < 1 || resolvedSourcePaths.length > OUTPUT_NAMES.length) {
    throw new Error('usage: provide 1..33 named preset source images');
  }
  if (new Set(resolvedSourcePaths).size !== resolvedSourcePaths.length) {
    throw new Error('each preset requires an independently generated source file');
  }
  const sourceRows = resolvedSourcePaths.map((sourcePath) => ({
    sourcePath,
    outputName: targetName(sourcePath),
  }));
  if (new Set(sourceRows.map((row) => row.outputName)).size !== sourceRows.length) {
    throw new Error('each preset slug may appear only once');
  }
  for (const row of sourceRows) {
    const sourceStat = await stat(row.sourcePath);
    if (!sourceStat.isFile() || sourceStat.size === 0) {
      throw new Error(`invalid source file: ${row.sourcePath}`);
    }
  }
  const supplied = new Map();
  for (const row of sourceRows) supplied.set(row.outputName, await encodeSource(row.sourcePath));
  const omitted = OUTPUT_NAMES.filter((name) => !supplied.has(name));
  const preserved = await existingEncodedFiles(outputDirectory, omitted);
  const encodedFiles = OUTPUT_NAMES.map((name) => ({
    name,
    bytes: supplied.get(name) ?? preserved.get(name),
  }));
  if (encodedFiles.some((row) => row.bytes === undefined)) {
    throw new Error('preset image batch is incomplete');
  }
  const hashes = encodedFiles.map((row) =>
    createHash('sha256').update(row.bytes).digest('hex'),
  );
  if (new Set(hashes).size !== hashes.length) {
    throw new Error('each preset requires different encoded image bytes');
  }
  await replacePresetFoodOutputDirectory({
    outputDirectory,
    encodedFiles,
    expectedOutputNames: OUTPUT_NAMES,
  });
}
```

`replacePresetFoodOutputDirectory()` 的写入循环改为按 `row.name` 写文件，并在创建 staging 前验证 `encodedFiles` 的名称集合与 `expectedOutputNames` 完全相等；保留现有 staging → backup → output 两次 rename 和回滚语义。

- [ ] **Step 5: 运行图片事务测试**

Run: `npm test -- src/data/presetFoods.test.ts -t "增量|slug|rename|保持不变"`

Expected: PASS；临时目录中不残留 `.staging-*` 或 `.backup-*`。

- [ ] **Step 6: 提交增量资产流水线**

```bash
git add scripts/preset-food-image-output-names.mjs scripts/prepare-preset-food-images.mjs src/data/presetFoods.test.ts
git commit -m "feat: support atomic partial preset image batches"
```

### Task 4: 扩充 33 项 provenance 和 manifest 门禁

**Files:**
- Modify: `scripts/preset-food-image-provenance.mjs`
- Modify: `scripts/build-preset-food-image-manifest.mjs`
- Modify: `src/data/presetFoods.test.ts`
- Test: `src/data/presetFoods.test.ts`

- [ ] **Step 1: 先锁定 33 项 provenance，并允许新图在审核前不进入 manifest**

```ts
test('33 项目录、输出名与 provenance 双向一一对应', async () => {
  const provenanceUrl = pathToFileURL(
    resolve(REPOSITORY_ROOT, 'scripts/preset-food-image-provenance.mjs'),
  ).href;
  const outputNamesUrl = pathToFileURL(
    resolve(REPOSITORY_ROOT, 'scripts/preset-food-image-output-names.mjs'),
  ).href;
  const { PRESET_FOOD_IMAGE_PROVENANCE } = await import(provenanceUrl);
  const { PRESET_FOOD_IMAGE_OUTPUT_NAMES } = await import(outputNamesUrl);
  expect(PRESET_FOODS).toHaveLength(33);
  expect(PRESET_FOOD_IMAGE_PROVENANCE).toHaveLength(33);
  expect(new Set(PRESET_FOOD_IMAGE_PROVENANCE.map((row) => row.foodId))).toEqual(
    new Set(PRESET_FOODS.map((food) => food.id)),
  );
  expect(PRESET_FOOD_IMAGE_PROVENANCE.map(
    (row) => row.path.replace('/food-presets/', ''),
  )).toEqual(
    PRESET_FOOD_IMAGE_OUTPUT_NAMES,
  );
  const reviewed = PRESET_FOOD_IMAGE_PROVENANCE.filter((row) => row.reviewed === true);
  const generatedWithoutHashes = PRESET_FOOD_IMAGE_MANIFEST.map(
    ({ sha256: _sha256, ...row }) => row,
  );
  expect(generatedWithoutHashes).toEqual(reviewed);
  expect(reviewed).toHaveLength(3);
});
```

- [ ] **Step 2: 运行测试并确认 provenance 仍只有 3 项**

Run: `npm test -- src/data/presetFoods.test.ts -t "输出名与 provenance"`

Expected: FAIL，实际 provenance 长度为 3。

- [ ] **Step 3: 更新视觉前后缀并写入 30 个精确 subject**

保留已有三行；把公共后缀改为特写规则，并增加以下数据。`reviewed` 在图片逐张通过 Task 5 的视觉检查后才设为 `true`：

```js
const PROMPT_SUFFIX =
  'Edible form matching the label; extreme close crop with food filling about 78-88 percent of the frame; top-down to 45-degree camera; shallow white or light ceramic dish, or a plain clear glass for liquids; soft neutral light-gray background; natural texture; no garnish that changes nutrition; no text; no logo; no packaging; no hands; one food only; square production catalog photo.';

const NEW_IMAGE_ROWS = [
  ['food:preset:usda:173905', 'oatmeal-porridge', '熟燕麦粥', '清水煮熟', 'cooked oatmeal porridge with visible oat texture, plain with no toppings'],
  ['food:preset:usda:172688', 'whole-wheat-bread', '全麦面包', '原味即食', 'two plain slices of whole-wheat bread'],
  ['food:preset:usda:168483', 'sweet-potato', '熟红薯', '烘烤熟制，无添加', 'cooked sweet potato split open, no toppings'],
  ['food:preset:usda:169999', 'sweet-corn', '熟玉米', '水煮沥干，无盐', 'cooked yellow sweet corn kernels'],
  ['food:preset:usda:170440', 'boiled-potato', '熟土豆', '去皮水煮，无盐', 'cooked peeled potato pieces'],
  ['food:preset:usda:172388', 'chicken-thigh', '熟鸡腿肉', '去皮烤制', 'skinless roasted chicken thigh meat, plainly sliced'],
  ['food:preset:usda:168250', 'pork-tenderloin', '熟猪里脊', '瘦肉烤制', 'roasted lean pork tenderloin, plainly sliced'],
  ['food:preset:usda:175168', 'salmon', '熟三文鱼', '大西洋养殖三文鱼干热熟制', 'cooked farmed Atlantic salmon fillet with no sauce'],
  ['food:preset:usda:171971', 'shrimp', '熟虾仁', '湿热熟制', 'cooked peeled shrimp with no sauce'],
  ['food:preset:usda:173424', 'boiled-egg', '水煮蛋', '全蛋水煮', 'hard-boiled egg halves with no seasoning'],
  ['food:preset:usda:172475', 'firm-tofu', '北豆腐', '硫酸钙凝固硬豆腐', 'plain firm tofu cubes'],
  ['food:preset:usda:171265', 'whole-milk', '纯牛奶', '全脂 3.25%，无糖', 'whole milk in a plain clear glass'],
  ['food:preset:usda:171284', 'plain-yogurt', '原味酸奶', '全脂原味，无糖', 'plain unsweetened yogurt in a shallow bowl'],
  ['food:preset:usda:169967', 'broccoli', '西兰花', '水煮沥干，无盐', 'cooked broccoli florets'],
  ['food:preset:usda:168463', 'spinach', '菠菜', '水煮沥干，无盐', 'cooked drained spinach'],
  ['food:preset:usda:170457', 'tomato', '番茄', '生食，可食部分', 'raw ripe red tomato'],
  ['food:preset:usda:168409', 'cucumber', '黄瓜', '带皮生食，可食部分', 'raw cucumber with peel'],
  ['food:preset:usda:170393', 'carrot', '胡萝卜', '生食，可食部分', 'raw carrot'],
  ['food:preset:usda:171688', 'apple', '苹果', '带皮生食，可食部分', 'raw red apple with skin'],
  ['food:preset:usda:173944', 'banana', '香蕉', '去皮生食，可食部分', 'peeled banana'],
  ['food:preset:usda:169097', 'orange', '橙子', '去皮生食，可食部分', 'peeled orange segments'],
  ['food:preset:usda:2708352', 'cooked-noodles', '熟面条', '清水煮熟，沥干', 'plain cooked noodles, drained, with no sauce and no broth'],
  ['food:preset:nhc:adult-sarcopenia-2026:mantou', 'mantou', '馒头', '原味无馅蒸制', 'one plain unfilled white steamed mantou bun, not baozi and not flower roll'],
  ['food:preset:usda:171986', 'tuna', '金枪鱼', '水浸罐头、沥干、无盐', 'drained water-packed light tuna flakes'],
  ['food:preset:usda:171956', 'cod', '鳕鱼', '大西洋鳕鱼干热熟制', 'cooked Atlantic cod fillet with no sauce'],
  ['food:preset:usda:175215', 'unsweetened-soy-milk', '无糖豆浆', '无糖强化豆浆', 'unsweetened soy milk in a plain clear glass'],
  ['food:preset:usda:169249', 'leaf-lettuce', '生菜', '绿叶生菜生食', 'raw green leaf lettuce'],
  ['food:preset:usda:169975', 'cabbage', '卷心菜', '生食，可食部分', 'raw green cabbage wedge and loose leaves'],
  ['food:preset:usda:168437', 'shiitake', '香菇', '熟制，无盐', 'cooked shiitake mushrooms'],
  ['food:preset:usda:167762', 'strawberry', '草莓', '生食，可食部分', 'raw strawberries'],
] as const;

const newProvenance = NEW_IMAGE_ROWS.map(
  ([foodId, slug, name, preparation, subject]) => ({
    foodId,
    path: `/food-presets/${slug}.webp`,
    name,
    preparation,
    width: 256,
    height: 256,
    cropVersion: 'center-cover-256-v2',
    generator: 'OpenAI imagegen',
    generationDate: '2026-08-21',
    reviewed: false,
    prompt: `${PROMPT_PREFIX} ${subject}. ${PROMPT_SUFFIX}`,
    conversionRecipe: 'sharp@0.33.5/webp-effort6-quality-loop-v1',
    contentReview: `${name}与“${preparation}”状态一致；单一食物特写，无文字、包装、手部、第二种食物或改变营养含义的装饰`,
  }),
);
```

- [ ] **Step 4: 让 manifest builder 以 provenance 数量为唯一计数来源**

把固定 `3` 改为以下门禁，并保留路径安全、WebP 魔数、尺寸、大小、hash 唯一和 `reviewed === true` 检查：

```js
const expectedCount = PRESET_FOOD_IMAGE_PROVENANCE.length;
if (expectedCount !== 33) {
  throw new Error('preset provenance must contain exactly 33 rows');
}
if (
  new Set(provenance.map((row) => row.foodId)).size !== expectedCount ||
  new Set(provenance.map((row) => row.path)).size !== expectedCount
) {
  throw new Error('preset food IDs and asset paths must be unique');
}
```

- [ ] **Step 5: 运行 provenance 的纯数据测试**

Run: `npm test -- src/data/presetFoods.test.ts -t "provenance|未经人工审查"`

Expected: provenance 长度、输出名集合和“未经审核会被 builder 拒绝”测试 PASS；generated manifest 与真实资产测试仍只覆盖 3 个 `reviewed:true` 旧图，不声称新图已完成。

- [ ] **Step 6: 提交 provenance 和门禁**

```bash
git add scripts/preset-food-image-provenance.mjs scripts/build-preset-food-image-manifest.mjs src/data/presetFoods.test.ts
git commit -m "feat: define provenance for 33 preset food images"
```

### Task 5: 逐张生成、审核并压缩 30 张新图片

**Files:**
- Create: 本计划 File map 中列出的 30 个 `public/food-presets/*.webp`
- Modify: `src/data/presetFoodImageManifest.generated.ts`
- Verify: `scripts/preset-food-image-provenance.mjs`

- [ ] **Step 1: 使用 imagegen skill 逐项生成独立源图**

每次只调用一次 imagegen，提示词必须是 provenance 中该行的完整 `prompt`。把输出保存为 `/private/tmp/tiezheng-food-sources/<slug>.png`；30 个 slug 必须与 `NEW_IMAGE_ROWS` 完全一致。不得在一次生成中请求拼图或多个食物。

- [ ] **Step 2: 对 30 张源图执行逐张视觉门禁**

使用本地图片查看工具逐张检查。每张必须同时满足：主体占画面约 78%–88%；名称和生熟状态一致；只有一种食物；无包装、文字、商标、手、第二种食物；馒头为白色无馅蒸馒头。任何一项不满足就只重新生成该 slug。

全部 30 张通过后，把 `newProvenance` 中固定的 `reviewed: false` 改为 `reviewed: true`。这一步只能在视觉检查完成后执行；`contentReview` 字符串就是本次人工审核的逐项声明。

- [ ] **Step 3: 用命名增量批次生成正式 WebP**

Run: `npm run food-assets:prepare -- /private/tmp/tiezheng-food-sources/*.png`

Expected: 命令退出码为 0；正式目录包含 33 个 `.webp`；现有三图 SHA-256 与执行前一致；每张新图为 256×256 且不超过 35 KB。

- [ ] **Step 4: 重建 manifest**

Run: `npm run food-assets:manifest`

Expected: `src/data/presetFoodImageManifest.generated.ts` 生成 33 行，每行包含唯一 SHA-256，且没有未审核条目。

- [ ] **Step 5: 把最终 manifest 一一对应断言加入测试**

```ts
test('最终 33 项 manifest 都已审核且路径与 hash 唯一', () => {
  expect(PRESET_FOOD_IMAGE_MANIFEST).toHaveLength(33);
  expect(new Set(PRESET_FOOD_IMAGE_MANIFEST.map((row) => row.foodId))).toEqual(
    new Set(PRESET_FOODS.map((food) => food.id)),
  );
  expect(new Set(PRESET_FOOD_IMAGE_MANIFEST.map((row) => row.path)).size).toBe(33);
  expect(new Set(PRESET_FOOD_IMAGE_MANIFEST.map((row) => row.sha256)).size).toBe(33);
  expect(PRESET_FOOD_IMAGE_MANIFEST.every((row) => row.reviewed === true)).toBe(true);
});
```

- [ ] **Step 6: 运行真实资产完整性测试**

Run: `npm test -- src/data/presetFoods.test.ts`

Expected: 所有目录、provenance、WebP、hash、原子回滚和深冻结测试 PASS。

- [ ] **Step 7: 提交图片与生成 manifest**

```bash
git add public/food-presets scripts/preset-food-image-provenance.mjs src/data/presetFoodImageManifest.generated.ts src/data/presetFoods.test.ts
git commit -m "feat: add reviewed images for 33 preset foods"
```

### Task 6: 锁定选择器 33 图、无占位符和搜索回归

**Files:**
- Modify: `src/screens/health/FoodPickerSheet.test.tsx`
- Verify: `src/screens/health/FoodPickerSheet.tsx`
- Test: `src/screens/health/FoodPickerSheet.test.tsx`

- [ ] **Step 1: 把三图断言改为 33 图并增加馒头搜索**

```tsx
test('33 种基础食物全部使用独立本地图且不显示占位符', async () => {
  const user = userEvent.setup();
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  const { container } = picker();
  const images = [...container.querySelectorAll('img')];
  expect(images).toHaveLength(33);
  expect(new Set(images.map((image) => image.getAttribute('src'))).size).toBe(33);
  expect(images.every((image) => image.getAttribute('src')?.endsWith('.webp'))).toBe(true);
  expect(screen.queryByText('暂无图片')).not.toBeInTheDocument();
  await user.type(screen.getByLabelText('搜索食物'), '白馒头');
  expect(screen.getByRole('button', { name: '馒头' })).toBeInTheDocument();
  expect(fetchSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 运行选择器测试**

Run: `npm test -- src/screens/health/FoodPickerSheet.test.tsx`

Expected: PASS；现有选择、实际数量、手动标签、保存锁和焦点陷阱测试保持通过。

- [ ] **Step 3: 若组件无需改动，只提交测试更新**

当前 `FoodPickerSheet.tsx` 已按 manifest 的 `foodId` 映射图片；若 33 项均显示，则不修改组件。提交：

```bash
git add src/screens/health/FoodPickerSheet.test.tsx
git commit -m "test: cover 33 preset foods in picker"
```

### Task 7: Ticket A 全量验证与交付证据

**Files:**
- Verify: `src/data/presetFoods.ts`
- Verify: `scripts/prepare-preset-food-images.mjs`
- Verify: `scripts/preset-food-image-provenance.mjs`
- Verify: `src/data/presetFoodImageManifest.generated.ts`
- Verify: `public/food-presets/*.webp`

- [ ] **Step 1: 验证生成物可重复**

先记录 manifest 文件 hash，执行 `npm run food-assets:manifest`，再次计算 hash；两次必须相同。然后运行：

Run: `git diff --exit-code -- src/data/presetFoodImageManifest.generated.ts`

Expected: 退出码 0。

- [ ] **Step 2: 运行 Ticket A 测试、类型检查和构建**

```bash
npm test -- src/data/presetFoods.test.ts src/lib/photoAiContract.test.ts src/repos/foodRepo.test.ts src/screens/health/FoodPickerSheet.test.tsx src/screens/health/HealthScreen.test.tsx
npm run test:edge -- workers/photo-ai-gateway/src/doubaoAdapter.test.ts workers/photo-ai-gateway/src/doubaoSchema.test.ts workers/photo-ai-gateway/src/handler.test.ts
npm run typecheck
npm run typecheck:edge
npm run build
```

Expected: 五条命令全部退出码 0；照片 adapter 使用 33 项目录提示和 `tiezheng-food-catalog-v2`，Vite 构建成功。

- [ ] **Step 3: 浏览器冒烟**

在本地 `/health` 打开午餐“选择食物”，验证：33 张图可滚动查看；搜索“馒头”和“白馒头”都只显示馒头；点击后可按克数保存；手动添加仍可用；界面不出现“暂无图片”；网络面板不请求第三方图片域名。

- [ ] **Step 4: 检查工作树仅包含 Ticket A 范围**

Run: `git status --short && git diff --stat HEAD~1`

Expected: 没有临时源图、下载数据集、staging/backup 目录或文字 AI 文件进入提交。

- [ ] **Step 5: 如验证产生未提交的确定性修正，提交最终修正**

```bash
git add src/data/presetFoods.ts src/data/presetFoods.test.ts src/lib/photoAiContract.ts src/lib/photoAiContract.test.ts scripts/preset-food-image-output-names.mjs scripts/prepare-preset-food-images.mjs scripts/preset-food-image-provenance.mjs scripts/build-preset-food-image-manifest.mjs src/data/presetFoodImageManifest.generated.ts src/screens/health/FoodPickerSheet.test.tsx public/food-presets
git commit -m "fix: finalize preset food catalog assets"
```

如果 Step 4 显示没有未提交变更，则不创建空提交。
