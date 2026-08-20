export interface GatewayEnv {
  IMAGES: ImagesBinding;
  PHOTO_AI_COORDINATOR: DurableObjectNamespace<import('./coordinator').PhotoAiCoordinator>;
  PHOTO_AI_GATEWAY_ENABLED: string;
  PHOTO_AI_MODEL: string;
  PHOTO_AI_ALLOWED_ORIGINS: string;
  PHOTO_AI_MONTHLY_BUDGET_MICROS: string;
  ARK_API_KEY: string;
  PHOTO_AI_CACHE_AES_KEY: string;
}
