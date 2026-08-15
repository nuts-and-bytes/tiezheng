const PROMPT_PREFIX =
  'Single isolated realistic food photograph for a mobile nutrition catalog:';
const PROMPT_SUFFIX =
  'Cooked edible form matching the label, top-down to 45-degree camera, shallow white ceramic dish, soft neutral light-gray background, natural texture, no garnish that changes nutrition, no text, no logo, no packaging, no hands, one food only, centered, square composition, production catalog photography.';

export const PRESET_FOOD_IMAGE_PROVENANCE = Object.freeze([
  {
    foodId: 'food:preset:usda:168878',
    path: '/food-presets/rice.webp',
    name: '熟米饭',
    preparation: '蒸煮',
    width: 256,
    height: 256,
    cropVersion: 'center-cover-256-v1',
    generator: 'OpenAI imagegen',
    generationDate: '2026-08-15',
    reviewed: true,
    prompt: `${PROMPT_PREFIX} steamed cooked white rice, distinct moist grains. ${PROMPT_SUFFIX}`,
    conversionRecipe: 'sharp@0.33.5/webp-effort6-quality-loop-v1',
    contentReview:
      '单碗熟白米饭，米粒和蒸煮形态可识别，无文字、包装、手部或额外食物',
  },
  {
    foodId: 'food:preset:usda:171477',
    path: '/food-presets/chicken-breast.webp',
    name: '熟鸡胸肉',
    preparation: '去皮熟制',
    width: 256,
    height: 256,
    cropVersion: 'center-cover-256-v1',
    generator: 'OpenAI imagegen',
    generationDate: '2026-08-15',
    reviewed: true,
    prompt: `${PROMPT_PREFIX} skinless cooked chicken breast, plainly sliced, not fried. ${PROMPT_SUFFIX}`,
    conversionRecipe: 'sharp@0.33.5/webp-effort6-quality-loop-v1',
    contentReview:
      '单盘去皮熟鸡胸肉，切片和熟制形态可识别，非油炸，无文字、包装、手部或额外食物',
  },
  {
    foodId: 'food:preset:usda:170236',
    path: '/food-presets/lean-beef.webp',
    name: '熟瘦牛肉',
    preparation: '瘦肉熟制',
    width: 256,
    height: 256,
    cropVersion: 'center-cover-256-v1',
    generator: 'OpenAI imagegen',
    generationDate: '2026-08-15',
    reviewed: true,
    prompt: `${PROMPT_PREFIX} cooked lean beef, plainly sliced, no visible sauce. ${PROMPT_SUFFIX}`,
    conversionRecipe: 'sharp@0.33.5/webp-effort6-quality-loop-v1',
    contentReview:
      '单盘熟瘦牛肉，切片和熟制形态可识别，无可见酱汁，无文字、包装、手部或额外食物',
  },
]);
