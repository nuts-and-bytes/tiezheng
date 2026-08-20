import type { GatewayEnv } from '../src/env';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends GatewayEnv {}
}

export {};
