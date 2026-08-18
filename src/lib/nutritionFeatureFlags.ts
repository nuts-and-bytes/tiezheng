export function autoNutritionTargetsEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_AUTO_NUTRITION_TARGETS === 'true';
}

export function photoAiEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_PHOTO_AI === 'true';
}
