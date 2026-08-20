export interface PhotoAiCoordinator {
  fetch(request: Request): Promise<Response>;
}

export interface GatewayEnv {
  IMAGES: ImagesBinding;
  PHOTO_AI_COORDINATOR: PhotoAiCoordinator;
  PHOTO_AI_ENABLED: string;
  PHOTO_AI_MODEL_VERSION: string;
  PHOTO_AI_ALLOWED_ORIGINS: string;
  PHOTO_AI_DAILY_BUDGET: string;
  PHOTO_AI_PROVIDER_API_KEY: string;
  PHOTO_AI_CACHE_KEY_PREFIX: string;
}
