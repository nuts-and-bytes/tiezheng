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
import { PRESET_FOOD_IMAGE_MANIFEST } from './presetFoodImageManifest.generated';
import { PRESET_FOODS } from './presetFoods';
import type { Food } from '../lib/nutritionTypes';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..');

type PreparePresetFoodImages = (options: {
  sourcePaths: string[];
  outputDirectory: string;
}) => Promise<void>;

type ReplacePresetFoodOutputDirectory = (options: {
  outputDirectory: string;
  encodedFiles: Uint8Array[];
  operationId: string;
  fileOps?: {
    rename?: (oldPath: string, newPath: string) => Promise<void>;
    remove?: (
      path: string,
      options: { recursive: boolean; force: boolean },
    ) => Promise<void>;
  };
}) => Promise<void>;

const OUTPUT_NAMES = ['rice.webp', 'chicken-breast.webp', 'lean-beef.webp'];

async function loadAssetPreparationModule() {
  const prepareUrl = pathToFileURL(
    resolve(REPOSITORY_ROOT, 'scripts/prepare-preset-food-images.mjs'),
  ).href;
  return (await import(/* @vite-ignore */ prepareUrl)) as {
    preparePresetFoodImages: PreparePresetFoodImages;
    replacePresetFoodOutputDirectory: ReplacePresetFoodOutputDirectory;
  };
}

async function writeBatch(directory: string, values: readonly Uint8Array[]) {
  await mkdir(directory, { recursive: true });
  await Promise.all(
    OUTPUT_NAMES.map((name, index) =>
      writeFile(resolve(directory, name), values[index]),
    ),
  );
}

async function readBatch(directory: string) {
  return Promise.all(
    OUTPUT_NAMES.map((name) => readFile(resolve(directory, name))),
  );
}

async function transactionArtifacts(parentDirectory: string) {
  return (await readdir(parentDirectory))
    .filter(
      (name) =>
        name.startsWith('.food-presets.staging-') ||
        name.startsWith('.food-presets.backup-'),
    )
    .sort();
}

test('首批目录锁定官方 USDA 身份、快照和标准化值', () => {
  expect(
    PRESET_FOODS.map(
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
    PRESET_FOODS.every(
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

  expect(new Set(PRESET_FOODS.map((food) => food.aliases)).size).toBe(3);
  expect(new Set(PRESET_FOODS.map((food) => food.conversionAssumptions)).size).toBe(3);
});

test('预设目录保持 Food[] 和 Food 的对外类型兼容', () => {
  const acceptFoodArray = (foods: Food[]) => foods.length;
  const acceptFood = (food: Food) => food.id;

  expect(acceptFoodArray(PRESET_FOODS)).toBe(3);
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

test('第二个源图无法解码时，三个正式输出全部保持不变', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'tiezheng-food-assets-'));
  const sourceDirectory = resolve(temporaryRoot, 'sources');
  const outputDirectory = resolve(temporaryRoot, 'food-presets');
  const sourcePaths = [
    resolve(sourceDirectory, 'rice.png'),
    resolve(sourceDirectory, 'invalid-chicken.png'),
    resolve(sourceDirectory, 'beef.png'),
  ];
  const outputPaths = [
    resolve(outputDirectory, 'rice.webp'),
    resolve(outputDirectory, 'chicken-breast.webp'),
    resolve(outputDirectory, 'lean-beef.webp'),
  ];
  const sentinels = [
    Buffer.from('sentinel-rice'),
    Buffer.from('sentinel-chicken'),
    Buffer.from('sentinel-beef'),
  ];

  try {
    await mkdir(sourceDirectory, { recursive: true });
    await mkdir(outputDirectory, { recursive: true });
    const riceSource = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#f4f4f0' },
    })
      .png()
      .toBuffer();
    const beefSource = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#7d4438' },
    })
      .png()
      .toBuffer();
    await Promise.all([
      writeFile(sourcePaths[0], riceSource),
      writeFile(sourcePaths[1], Buffer.from('not-an-image')),
      writeFile(sourcePaths[2], beefSource),
      ...outputPaths.map((path, index) => writeFile(path, sentinels[index])),
    ]);

    const prepareUrl = pathToFileURL(
      resolve(REPOSITORY_ROOT, 'scripts/prepare-preset-food-images.mjs'),
    ).href;
    const { preparePresetFoodImages } = (await import(
      /* @vite-ignore */ prepareUrl
    )) as {
      preparePresetFoodImages: PreparePresetFoodImages;
    };

    await expect(
      preparePresetFoodImages({ sourcePaths, outputDirectory }),
    ).rejects.toThrow();
    await expect(Promise.all(outputPaths.map((path) => readFile(path)))).resolves.toEqual(
      sentinels,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('staging 提交失败时从 backup 恢复原三文件并清理事务目录', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'tiezheng-swap-rollback-'));
  const outputDirectory = resolve(parentDirectory, 'food-presets');
  const operationId = 'rollback-restores-original';
  const stagingDirectory = resolve(
    parentDirectory,
    `.food-presets.staging-${operationId}`,
  );
  const sentinels = [
    Buffer.from('sentinel-rice'),
    Buffer.from('sentinel-chicken'),
    Buffer.from('sentinel-beef'),
  ];
  const replacements = [
    Buffer.from('replacement-rice'),
    Buffer.from('replacement-chicken'),
    Buffer.from('replacement-beef'),
  ];
  const commitError = new Error('injected staging commit failure');

  try {
    await writeBatch(outputDirectory, sentinels);
    const { replacePresetFoodOutputDirectory } = await loadAssetPreparationModule();

    await expect(
      replacePresetFoodOutputDirectory({
        outputDirectory,
        encodedFiles: replacements,
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
  const sentinels = [
    Buffer.from('sentinel-rice'),
    Buffer.from('sentinel-chicken'),
    Buffer.from('sentinel-beef'),
  ];
  const replacements = [
    Buffer.from('replacement-rice'),
    Buffer.from('replacement-chicken'),
    Buffer.from('replacement-beef'),
  ];
  const commitError = new Error('injected staging commit failure');
  const rollbackError = new Error('injected backup restore failure');

  try {
    await writeBatch(outputDirectory, sentinels);
    const { replacePresetFoodOutputDirectory } = await loadAssetPreparationModule();
    let caught: unknown;

    try {
      await replacePresetFoodOutputDirectory({
        outputDirectory,
        encodedFiles: replacements,
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

test('成功 swap 整批替换三文件且不留 staging 或 backup', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'tiezheng-swap-success-'));
  const outputDirectory = resolve(parentDirectory, 'food-presets');
  const sentinels = [
    Buffer.from('sentinel-rice'),
    Buffer.from('sentinel-chicken'),
    Buffer.from('sentinel-beef'),
  ];
  const replacements = [
    Buffer.from('replacement-rice'),
    Buffer.from('replacement-chicken'),
    Buffer.from('replacement-beef'),
  ];

  try {
    await writeBatch(outputDirectory, sentinels);
    const { replacePresetFoodOutputDirectory } = await loadAssetPreparationModule();

    await replacePresetFoodOutputDirectory({
      outputDirectory,
      encodedFiles: replacements,
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
  const sentinels = [
    Buffer.from('sentinel-rice'),
    Buffer.from('sentinel-chicken'),
    Buffer.from('sentinel-beef'),
  ];
  const replacements = [
    Buffer.from('replacement-rice'),
    Buffer.from('replacement-chicken'),
    Buffer.from('replacement-beef'),
  ];
  const cleanupError = new Error('injected backup cleanup failure');

  try {
    await writeBatch(outputDirectory, sentinels);
    const { replacePresetFoodOutputDirectory } = await loadAssetPreparationModule();
    let caught: unknown;

    try {
      await replacePresetFoodOutputDirectory({
        outputDirectory,
        encodedFiles: replacements,
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
