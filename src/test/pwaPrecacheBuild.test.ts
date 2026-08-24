import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, test } from 'vitest';
import { PRESET_FOOD_IMAGE_MANIFEST } from '../data/presetFoodImageManifest.generated';

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

test('fresh production service worker precaches exactly all 33 selector WebP assets with revisions', async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'tiezheng-pwa-build-'));
  temporaryDirectories.push(temporaryDirectory);
  const outDir = join(temporaryDirectory, 'dist');

  await execFileAsync(
    process.execPath,
    [
      resolve('node_modules/vite/bin/vite.js'),
      'build',
      '--outDir',
      outDir,
      '--emptyOutDir',
      '--logLevel',
      'silent',
    ],
    { cwd: resolve('.'), maxBuffer: 2_000_000 },
  );

  const serviceWorker = await readFile(join(outDir, 'sw.js'), 'utf8');
  const precachedWebp = [...serviceWorker.matchAll(
    /\{\s*["']?url["']?\s*:\s*["'](food-presets\/[a-z0-9-]+\.webp)["']\s*,\s*["']?revision["']?\s*:\s*["']([a-f0-9]{32})["']\s*\}/g,
  )].map((match) => ({ url: `/${match[1]}`, revision: match[2] }));
  const selectorUrls = PRESET_FOOD_IMAGE_MANIFEST.map((row) => row.path).sort();

  expect(selectorUrls).toHaveLength(33);
  expect(precachedWebp.map(({ url }) => url).sort()).toEqual(selectorUrls);
  expect(precachedWebp.every(({ revision }) => /^[a-f0-9]{32}$/.test(revision))).toBe(true);
}, 20_000);
