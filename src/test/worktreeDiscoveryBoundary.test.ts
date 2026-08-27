import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, matchesGlob } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKTREE_EXCLUDE = '**/.worktrees/**';
const LOAD_CONFIG_SOURCE = `
  import { loadConfigFromFile } from 'vite';
  const loaded = await loadConfigFromFile(
    {
      command: 'serve',
      mode: 'test',
      isPreview: false,
      isSsrBuild: false,
    },
    process.argv[1],
  );
  process.stdout.write(JSON.stringify(loaded?.config?.test?.exclude ?? null));
`;

function readExcludePatterns(configFile: string): string[] {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', LOAD_CONFIG_SOURCE, configFile],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 10_000,
    },
  );

  if (result.status !== 0) {
    throw new Error('Unable to load the effective Vitest configuration');
  }

  const value: unknown = JSON.parse(result.stdout);
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error('Vitest test.exclude must be a string array');
  }

  return value;
}

function readExcludePatternsFromSource(source: string): string[] {
  const directory = mkdtempSync(join(tmpdir(), 'tiezheng-vite-config-'));
  const configFile = join(directory, 'vite.config.mjs');

  try {
    writeFileSync(configFile, source, { encoding: 'utf8', mode: 0o600 });
    return readExcludePatterns(configFile);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

describe('Vitest discovery boundary', () => {
  it('excludes local Git worktrees from the main repository test run', () => {
    expect(readExcludePatterns('vite.config.ts')).toContain(WORKTREE_EXCLUDE);
  });

  it('does not accept a commented-out worktree exclude as active configuration', () => {
    const source = `
      export default {
        test: {
          exclude: [
            // '${WORKTREE_EXCLUDE}',
          ],
        },
      };
    `;

    expect(readExcludePatternsFromSource(source)).not.toContain(WORKTREE_EXCLUDE);
  });

  it('does not accept a worktree exclude overwritten inside the test object', () => {
    const source = `
      export default {
        test: {
          exclude: ['${WORKTREE_EXCLUDE}'],
          ...{ exclude: [] },
        },
      };
    `;

    expect(readExcludePatternsFromSource(source)).not.toContain(WORKTREE_EXCLUDE);
  });

  it('does not accept a worktree exclude overwritten at the top level', () => {
    const source = `
      export default {
        test: { exclude: ['${WORKTREE_EXCLUDE}'] },
        ...{ test: { exclude: [] } },
      };
    `;

    expect(readExcludePatternsFromSource(source)).not.toContain(WORKTREE_EXCLUDE);
  });

  it('loads function configs with the complete non-preview Vite environment', () => {
    const source = `
      export default ({ isPreview, isSsrBuild }) => ({
        test: {
          exclude:
            isPreview === undefined && isSsrBuild === undefined
              ? ['${WORKTREE_EXCLUDE}']
              : [],
        },
      });
    `;

    expect(readExcludePatternsFromSource(source)).not.toContain(WORKTREE_EXCLUDE);
  });

  it('matches only root or nested .worktrees directories', () => {
    const isExcluded = (path: string) => matchesGlob(path, WORKTREE_EXCLUDE);

    expect(isExcluded('.worktrees/task/src/example.test.ts')).toBe(true);
    expect(isExcluded('repo/.worktrees/task/src/example.test.ts')).toBe(true);
    expect(isExcluded('worktrees/task/src/example.test.ts')).toBe(false);
    expect(isExcluded('.worktrees-old/task/src/example.test.ts')).toBe(false);
    expect(isExcluded('src/example.test.ts')).toBe(false);
  });
});
