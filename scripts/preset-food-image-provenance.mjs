const PROMPT_PREFIX =
  'Single isolated realistic food photograph for a mobile nutrition catalog:';
const LEGACY_PROMPT_SUFFIX =
  'Cooked edible form matching the label, top-down to 45-degree camera, shallow white ceramic dish, soft neutral light-gray background, natural texture, no garnish that changes nutrition, no text, no logo, no packaging, no hands, one food only, centered, square composition, production catalog photography.';
const PROMPT_SUFFIX =
  'Edible form matching the label; extreme close crop with food filling about 78-88 percent of the frame; top-down to 45-degree camera; shallow white or light ceramic dish, or a plain clear glass for liquids; soft neutral light-gray background; natural texture; no garnish that changes nutrition; no text; no logo; no packaging; no hands; one food only; square production catalog photo.';

const REVIEWED_IMAGE_ROWS = [
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
    prompt: `${PROMPT_PREFIX} steamed cooked white rice, distinct moist grains. ${LEGACY_PROMPT_SUFFIX}`,
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
    prompt: `${PROMPT_PREFIX} skinless cooked chicken breast, plainly sliced, not fried. ${LEGACY_PROMPT_SUFFIX}`,
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
    prompt: `${PROMPT_PREFIX} cooked lean beef, plainly sliced, no visible sauce. ${LEGACY_PROMPT_SUFFIX}`,
    conversionRecipe: 'sharp@0.33.5/webp-effort6-quality-loop-v1',
    contentReview:
      '单盘熟瘦牛肉，切片和熟制形态可识别，无可见酱汁，无文字、包装、手部或额外食物',
  },
];

const NEW_IMAGE_ROWS = [
  ['food:preset:usda:173905', 'oatmeal-porridge', '熟燕麦粥', '清水煮熟', 'cooked oatmeal porridge with visible oat texture, plain with no toppings'],
  ['food:preset:usda:172688', 'whole-wheat-bread', '全麦面包', '原味即食', 'two plain slices of whole-wheat bread'],
  ['food:preset:usda:168483', 'sweet-potato', '熟红薯', '烘烤熟制，无添加', 'cooked sweet potato split open, no toppings'],
  ['food:preset:usda:169999', 'sweet-corn', '熟玉米', '水煮沥干，无盐', 'cooked yellow sweet corn kernels'],
  ['food:preset:usda:170440', 'boiled-potato', '熟土豆', '去皮水煮，无盐', 'cooked peeled potato pieces'],
  ['food:preset:usda:172388', 'chicken-thigh', '熟鸡腿肉', '去皮烤制', 'skinless roasted chicken thigh meat, plainly sliced'],
  ['food:preset:usda:168250', 'pork-tenderloin', '熟猪里脊', '瘦肉烤制', 'roasted lean pork tenderloin, plainly sliced'],
  ['food:preset:usda:175168', 'salmon', '熟三文鱼', '大西洋养殖三文鱼干热熟制', 'cooked farmed Atlantic salmon fillet with no sauce'],
  ['food:preset:usda:171971', 'shrimp', '熟虾仁', '湿热熟制', 'cooked peeled shrimp with no sauce'],
  ['food:preset:usda:173424', 'boiled-egg', '水煮蛋', '全蛋水煮', 'hard-boiled egg halves with no seasoning'],
  ['food:preset:usda:172475', 'firm-tofu', '北豆腐', '硫酸钙凝固硬豆腐', 'plain firm tofu cubes'],
  ['food:preset:usda:171265', 'whole-milk', '纯牛奶', '全脂 3.25%，无糖', 'whole milk in a plain clear glass'],
  ['food:preset:usda:171284', 'plain-yogurt', '原味酸奶', '全脂原味，无糖', 'plain unsweetened yogurt in a shallow bowl'],
  ['food:preset:usda:169967', 'broccoli', '西兰花', '水煮沥干，无盐', 'cooked broccoli florets'],
  ['food:preset:usda:168463', 'spinach', '菠菜', '水煮沥干，无盐', 'cooked drained spinach'],
  ['food:preset:usda:170457', 'tomato', '番茄', '生食，可食部分', 'raw ripe red tomato'],
  ['food:preset:usda:168409', 'cucumber', '黄瓜', '带皮生食，可食部分', 'raw cucumber with peel'],
  ['food:preset:usda:170393', 'carrot', '胡萝卜', '生食，可食部分', 'raw carrot'],
  ['food:preset:usda:171688', 'apple', '苹果', '带皮生食，可食部分', 'raw red apple with skin'],
  ['food:preset:usda:173944', 'banana', '香蕉', '去皮生食，可食部分', 'peeled banana'],
  ['food:preset:usda:169097', 'orange', '橙子', '去皮生食，可食部分', 'peeled orange segments'],
  ['food:preset:usda:2708352', 'cooked-noodles', '熟面条', '清水煮熟，沥干', 'plain cooked noodles, drained, with no sauce and no broth'],
  ['food:preset:nhc:adult-sarcopenia-2026:mantou', 'mantou', '馒头', '原味无馅蒸制', 'one plain unfilled white steamed mantou bun, not baozi and not flower roll'],
  ['food:preset:usda:171986', 'tuna', '金枪鱼', '水浸罐头、沥干、无盐', 'drained water-packed light tuna flakes'],
  ['food:preset:usda:171956', 'cod', '鳕鱼', '大西洋鳕鱼干热熟制', 'cooked Atlantic cod fillet with no sauce'],
  ['food:preset:usda:175215', 'unsweetened-soy-milk', '无糖豆浆', '无糖强化豆浆', 'unsweetened soy milk in a plain clear glass'],
  ['food:preset:usda:169249', 'leaf-lettuce', '生菜', '绿叶生菜生食', 'raw green leaf lettuce'],
  ['food:preset:usda:169975', 'cabbage', '卷心菜', '生食，可食部分', 'raw green cabbage wedge and loose leaves'],
  ['food:preset:usda:168437', 'shiitake', '香菇', '熟制，无盐', 'cooked shiitake mushrooms'],
  ['food:preset:usda:167762', 'strawberry', '草莓', '生食，可食部分', 'raw strawberries'],
];

const newProvenance = NEW_IMAGE_ROWS.map(
  ([foodId, slug, name, preparation, subject]) => ({
    foodId,
    path: `/food-presets/${slug}.webp`,
    name,
    preparation,
    width: 256,
    height: 256,
    cropVersion: 'center-cover-256-v2',
    generator: 'OpenAI imagegen',
    generationDate: '2026-08-21',
    reviewed: false,
    prompt: `${PROMPT_PREFIX} ${subject}. ${PROMPT_SUFFIX}`,
    conversionRecipe: 'sharp@0.33.5/webp-effort6-quality-loop-v1',
    contentReview: `${name}与“${preparation}”状态一致；单一食物特写，无文字、包装、手部、第二种食物或改变营养含义的装饰`,
  }),
);

export const PRESET_FOOD_IMAGE_PROVENANCE = Object.freeze(
  [...REVIEWED_IMAGE_ROWS, ...newProvenance].map((row) =>
    Object.freeze({ ...row }),
  ),
);
