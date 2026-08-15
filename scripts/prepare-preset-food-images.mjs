import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const OUTPUT_NAMES = ['rice.webp', 'chicken-breast.webp', 'lean-beef.webp'];
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

export async function replacePresetFoodOutputDirectory({
  outputDirectory,
  encodedFiles,
  operationId = `${process.pid}-${randomUUID()}`,
  fileOps = {},
}) {
  if (encodedFiles.length !== OUTPUT_NAMES.length) {
    throw new Error('preset asset batch must contain exactly three encoded files');
  }
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
      encodedFiles.map((bytes, index) =>
        writeFile(resolve(stagingDirectory, OUTPUT_NAMES[index]), bytes),
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

  if (resolvedSourcePaths.length !== OUTPUT_NAMES.length) {
    throw new Error(
      'usage: npm run food-assets:prepare -- <rice-source> <chicken-source> <beef-source>',
    );
  }

  if (new Set(resolvedSourcePaths).size !== resolvedSourcePaths.length) {
    throw new Error('each preset requires an independently generated source file');
  }

  for (const sourcePath of resolvedSourcePaths) {
    const sourceStat = await stat(sourcePath);
    if (!sourceStat.isFile() || sourceStat.size === 0) {
      throw new Error(`invalid source file: ${sourcePath}`);
    }
  }

  const sourceHashes = await Promise.all(
    resolvedSourcePaths.map(async (sourcePath) =>
      createHash('sha256').update(await readFile(sourcePath)).digest('hex'),
    ),
  );

  if (new Set(sourceHashes).size !== resolvedSourcePaths.length) {
    throw new Error('each preset requires different source image bytes');
  }

  const encodedFiles = [];
  for (const sourcePath of resolvedSourcePaths) {
    encodedFiles.push(await encodeSource(sourcePath));
  }

  const encodedHashes = encodedFiles.map((bytes) =>
    createHash('sha256').update(bytes).digest('hex'),
  );
  if (new Set(encodedHashes).size !== encodedFiles.length) {
    throw new Error('each preset requires different encoded image bytes');
  }

  await replacePresetFoodOutputDirectory({ outputDirectory, encodedFiles });
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
