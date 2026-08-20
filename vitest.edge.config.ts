import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['workers/**/*.worker.test.ts'],
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './workers/photo-ai-gateway/wrangler.jsonc',
        },
      },
    },
  },
});
