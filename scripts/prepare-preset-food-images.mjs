import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { PRESET_FOOD_IMAGE_OUTPUT_NAMES } from './preset-food-image-output-names.mjs';

const OUTPUT_NAMES = PRESET_FOOD_IMAGE_OUTPUT_NAMES;
const OUTPUT_NAME_SET = new Set(OUTPUT_NAMES);
const QUALITIES = [82, 78, 74, 70, 66, 62, 58];
const MAX_BYTES = 35 * 1024;

const moduleUrl = new URL(import.meta.url);
if (moduleUrl.protocol !== 'file:') {
  throw new Error(`unexpected module URL: ${import.meta.url}`);
}
export const DEFAULT_REPOSITORY_ROOT = resolve(
  fileURLToPath(new URL('..', moduleUrl)),
);
export const DEFAULT_OUTPUT_DIRECTORY = resolve(
  DEFAULT_REPOSITORY_ROOT,
  'public/food-presets',
);

function isMissingPath(error) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isExistingPath(error) {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

function presetFoodOutputLockDirectory(outputDirectory) {
  const resolvedOutputDirectory = resolve(outputDirectory);
  return resolve(
    dirname(resolvedOutputDirectory),
    `.${basename(resolvedOutputDirectory)}.lock`,
  );
}

async function acquirePresetFoodOutputLock(outputDirectory) {
  const lockDirectory = presetFoodOutputLockDirectory(outputDirectory);
  await mkdir(dirname(lockDirectory), { recursive: true });
  try {
    await mkdir(lockDirectory);
  } catch (error) {
    if (isExistingPath(error)) {
      throw new Error(
        `preset image update already in progress; if no process is active, remove stale lock directory: ${lockDirectory}`,
        { cause: error },
      );
    }
    throw error;
  }
  return lockDirectory;
}

async function encodeSource(sourcePath) {
  for (const quality of QUALITIES) {
    const candidate = await sharp(sourcePath, { failOn: 'error' })
      .rotate()
      .resize(256, 256, { fit: 'cover', position: 'centre' })
      .webp({ quality, effort: 6, smartSubsample: true })
      .toBuffer();

    if (candidate.length <= MAX_BYTES) {
      return candidate;
    }
  }

  throw new Error(`${sourcePath} cannot fit the ${MAX_BYTES}-byte WebP budget`);
}

function targetName(sourcePath) {
  const slug = basename(sourcePath, extname(sourcePath));
  const name = `${slug}.webp`;
  if (!OUTPUT_NAME_SET.has(name)) {
    throw new Error(`unknown preset image slug: ${slug}`);
  }
  return name;
}

async function existingEncodedFiles(outputDirectory, omittedNames) {
  const rows = new Map();
  for (const name of omittedNames) {
    let bytes;
    try {
      bytes = await readFile(resolve(outputDirectory, name));
    } catch {
      throw new Error(`invalid existing preset image: ${name}`);
    }
    await validateExistingPresetImage(name, bytes);
    rows.set(name, bytes);
  }
  return rows;
}

async function validateExistingPresetImage(name, bytes) {
  try {
    if (
      bytes.length === 0 ||
      bytes.length > MAX_BYTES ||
      bytes.subarray(0, 4).toString() !== 'RIFF' ||
      bytes.subarray(8, 12).toString() !== 'WEBP'
    ) {
      throw new Error('invalid WebP envelope');
    }

    const metadata = await sharp(bytes, { failOn: 'error' }).metadata();
    if (
      metadata.format !== 'webp' ||
      metadata.width !== 256 ||
      metadata.height !== 256
    ) {
      throw new Error('invalid WebP metadata');
    }

    await sharp(bytes, { failOn: 'error' }).raw().toBuffer();
  } catch {
    throw new Error(`invalid existing preset image: ${name}`);
  }
}

function validateEncodedFileNames(encodedFiles, expectedOutputNames) {
  if (expectedOutputNames.length !== OUTPUT_NAMES.length) {
    throw new Error('expected preset output names must match the canonical batch');
  }
  const expectedNames = new Set(expectedOutputNames);
  if (expectedNames.size !== expectedOutputNames.length) {
    throw new Error('expected preset output names must be unique');
  }
  for (const name of expectedOutputNames) {
    if (!OUTPUT_NAME_SET.has(name)) {
      throw new Error(`unknown expected preset output name: ${name}`);
    }
  }
  if (encodedFiles.length !== expectedOutputNames.length) {
    throw new Error('encoded preset file count must match expected output names');
  }

  const seenNames = new Set();
  for (const row of encodedFiles) {
    if (seenNames.has(row.name)) {
      throw new Error(`duplicate encoded preset image name: ${row.name}`);
    }
    if (!expectedNames.has(row.name)) {
      throw new Error(`unknown encoded preset image name: ${row.name}`);
    }
    seenNames.add(row.name);
  }

  for (const name of expectedOutputNames) {
    if (!seenNames.has(name)) {
      throw new Error(`missing encoded preset image name: ${name}`);
    }
  }
}

export async function replacePresetFoodOutputDirectory({
  outputDirectory,
  encodedFiles,
  expectedOutputNames,
  operationId = `${process.pid}-${randomUUID()}`,
  fileOps = {},
}) {
  validateEncodedFileNames(encodedFiles, expectedOutputNames);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(operationId)) {
    throw new Error('invalid preset asset operation ID');
  }

  const renameEntry = fileOps.rename ?? rename;
  const removeEntry = fileOps.remove ?? rm;
  const resolvedOutputDirectory = resolve(outputDirectory);
  const parentDirectory = dirname(resolvedOutputDirectory);
  const outputName = basename(resolvedOutputDirectory);
  const stagingDirectory = resolve(
    parentDirectory,
    `.${outputName}.staging-${operationId}`,
  );
  const backupDirectory = resolve(
    parentDirectory,
    `.${outputName}.backup-${operationId}`,
  );

  // A hard process kill between the two renames can leave this named backup.
  // It contains the prior complete batch and can be renamed back manually.

  await mkdir(parentDirectory, { recursive: true });
  await mkdir(stagingDirectory);

  try {
    await Promise.all(
      encodedFiles.map((row) =>
        writeFile(resolve(stagingDirectory, row.name), row.bytes),
      ),
    );
  } catch (error) {
    await removeEntry(stagingDirectory, { recursive: true, force: true });
    throw error;
  }

  let existingOutputMoved = false;

  try {
    await renameEntry(resolvedOutputDirectory, backupDirectory);
    existingOutputMoved = true;
  } catch (error) {
    if (!isMissingPath(error)) {
      await removeEntry(stagingDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  try {
    await renameEntry(stagingDirectory, resolvedOutputDirectory);
  } catch (commitError) {
    let rollbackError;

    if (existingOutputMoved) {
      try {
        await renameEntry(backupDirectory, resolvedOutputDirectory);
      } catch (error) {
        rollbackError = error;
      }
    }

    await removeEntry(stagingDirectory, { recursive: true, force: true });

    if (rollbackError !== undefined) {
      throw new AggregateError(
        [commitError, rollbackError],
        'preset asset directory swap and rollback both failed',
      );
    }

    throw commitError;
  }

  if (existingOutputMoved) {
    try {
      await removeEntry(backupDirectory, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [cleanupError],
        `preset asset batch committed but backup cleanup failed; new output is active and the prior backup may remain at ${backupDirectory}`,
      );
    }
  }
}

export async function preparePresetFoodImages({
  sourcePaths,
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY,
}) {
  const resolvedSourcePaths = sourcePaths.map((value) => resolve(value));

  if (
    resolvedSourcePaths.length < 1 ||
    resolvedSourcePaths.length > OUTPUT_NAMES.length
  ) {
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

  const resolvedOutputDirectory = resolve(outputDirectory);
  const lockDirectory = await acquirePresetFoodOutputLock(
    resolvedOutputDirectory,
  );
  let operationFailed = false;
  let operationError;

  try {
    for (const row of sourceRows) {
      const sourceStat = await stat(row.sourcePath);
      if (!sourceStat.isFile() || sourceStat.size === 0) {
        throw new Error(`invalid source file: ${row.sourcePath}`);
      }
    }

    const supplied = new Map();
    for (const row of sourceRows) {
      supplied.set(row.outputName, await encodeSource(row.sourcePath));
    }

    const omitted = OUTPUT_NAMES.filter((name) => !supplied.has(name));
    const preserved = await existingEncodedFiles(
      resolvedOutputDirectory,
      omitted,
    );
    const encodedFiles = OUTPUT_NAMES.map((name) => ({
      name,
      bytes: supplied.get(name) ?? preserved.get(name),
    }));
    if (encodedFiles.some((row) => row.bytes === undefined)) {
      throw new Error('preset image batch is incomplete');
    }

    const encodedHashes = encodedFiles.map((row) =>
      createHash('sha256').update(row.bytes).digest('hex'),
    );
    if (new Set(encodedHashes).size !== encodedFiles.length) {
      throw new Error('each preset requires different encoded image bytes');
    }

    await replacePresetFoodOutputDirectory({
      outputDirectory: resolvedOutputDirectory,
      encodedFiles,
      expectedOutputNames: OUTPUT_NAMES,
    });
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  let lockCleanupFailed = false;
  let lockCleanupError;
  try {
    await rmdir(lockDirectory);
  } catch (error) {
    lockCleanupFailed = true;
    lockCleanupError = error;
  }

  if (operationFailed) {
    if (lockCleanupFailed) {
      throw new AggregateError(
        [operationError, lockCleanupError],
        `preset image update failed and lock cleanup failed; stale lock may remain at ${lockDirectory}`,
      );
    }
    throw operationError;
  }

  if (lockCleanupFailed) {
    throw new AggregateError(
      [lockCleanupError],
      `preset image batch committed but lock cleanup failed; new output is active and stale lock may remain at ${lockDirectory}`,
    );
  }
}

async function runCli() {
  await preparePresetFoodImages({ sourcePaths: process.argv.slice(2) });
}

const invokedScript = process.argv[1];
if (
  invokedScript !== undefined &&
  pathToFileURL(resolve(invokedScript)).href === import.meta.url
) {
  await runCli();
}
