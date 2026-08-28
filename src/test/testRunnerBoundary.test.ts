import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('test runner boundary', () => {
  it('routes node:test scripts away from Vitest and the throttle handler into Workers Vitest', () => {
    const rootConfig = readFileSync(resolve('vite.config.ts'), 'utf8');
    const edgeConfig = readFileSync(resolve('vitest.edge.config.ts'), 'utf8');
    const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(rootConfig).toContain("'scripts/**/*.test.mjs'");
    expect(rootConfig).toContain("'workers/photo-ai-gateway/src/textAuthThrottleHandler.test.ts'");
    expect(edgeConfig).toContain("'workers/photo-ai-gateway/src/textAuthThrottleHandler.test.ts'");
    expect(packageJson.scripts?.test).toBe('vitest run && npm run test:text-preview-control');
    expect(packageJson.scripts?.['test:watch']).toBe('vitest');
  });
});
