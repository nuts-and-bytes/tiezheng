import { PHOTO_AI_VERSIONS } from '../lib/photoAiContract';

export const photoAiCatalogCandidateFixture = {
  id: 'catalog-rice-001',
  name: '米饭',
  preparation: '熟制',
  amountLow: 140,
  amountHigh: 180,
  unit: 'g',
  catalogFoodId: 'food-rice-cooked',
  nutrientSource: 'catalog',
  energyKcalLow: null,
  energyKcalHigh: null,
  proteinGLow: null,
  proteinGHigh: null,
  assumptions: [],
} as const;

export const photoAiModelRangeCandidateFixture = {
  id: 'model-chicken-001',
  name: '鸡胸肉',
  preparation: '少油煮制',
  amountLow: 90,
  amountHigh: 130,
  unit: 'g',
  catalogFoodId: null,
  nutrientSource: 'model-range',
  energyKcalLow: 150,
  energyKcalHigh: 230,
  proteinGLow: 24,
  proteinGHigh: 36,
  assumptions: ['按去皮鸡胸肉估算'],
} as const;

export const photoAiNoNutrientCandidateFixture = {
  id: 'none-sauce-001',
  name: '自制酱汁',
  preparation: '混合',
  amountLow: 10,
  amountHigh: 20,
  unit: 'mL',
  catalogFoodId: null,
  nutrientSource: 'none',
  energyKcalLow: null,
  energyKcalHigh: null,
  proteinGLow: null,
  proteinGHigh: null,
  assumptions: [],
} as const;

export const photoAiSessionSuccessFixture = {
  ok: true,
  enabled: true,
  accountRemaining: 12,
  globalRemaining: 2_400,
  resetAt: '2026-09-01T00:00:00.000Z',
} as const;

export const photoAiEstimateSuccessFixture = {
  ok: true,
  status: 'complete',
  requestId: 'photo-request-001',
  requestFingerprint: 'a'.repeat(64),
  versions: { ...PHOTO_AI_VERSIONS },
  candidates: [
    photoAiCatalogCandidateFixture,
    photoAiModelRangeCandidateFixture,
    photoAiNoNutrientCandidateFixture,
  ],
} as const;

export const photoAiEstimateInFlightFixture = {
  ok: true,
  status: 'in-flight',
  requestId: 'photo-request-001',
  retryAfterMs: 750,
} as const;

export const photoAiFailureFixture = {
  ok: false,
  code: 'provider-unavailable',
  retryAt: '2026-08-18T12:01:00.000Z',
  resetAt: null,
} as const;
