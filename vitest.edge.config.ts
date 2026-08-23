import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: [
      'workers/**/*.worker.test.ts',
      'edge/nutrition-ai/**/*.test.ts',
      'edge/text-ai/pagesRequest.test.ts',
      'edge/text-ai/pagesProxy.test.ts',
      'edge/photo-ai/pagesProxy.test.ts',
      'edge/photo-ai/pagesRoutes.test.ts',
    ],
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './workers/photo-ai-gateway/wrangler.jsonc',
        },
      },
    },
  },
});
