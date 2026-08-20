export type PagesRoute = 'session' | 'estimate' | 'logout' | 'resume';

export interface PagesRequestConfig {
  origin: string;
}

export interface PagesRequestEnv {
  PHOTO_AI_PAGES_ORIGIN: string;
}

export interface ValidatedPagesRequest {
  route: PagesRoute;
}

export class PagesRequestError extends Error {
  constructor() {
    super('Invalid Pages request');
  }
}

const EXACT_HTTPS_ORIGIN = /^https:\/\/[a-z0-9.-]+$/;
const SESSION_PATH = '/api/nutrition/photo/session';
const ESTIMATE_PATH = '/api/nutrition/photo/estimate';
const LOGOUT_PATH = '/api/nutrition/photo/logout';
const MAX_ESTIMATE_BYTES = 1_100_000;

export function parsePagesRequestConfig(env: PagesRequestEnv): PagesRequestConfig {
  const value = env.PHOTO_AI_PAGES_ORIGIN;
  if (!EXACT_HTTPS_ORIGIN.test(value)) throw new PagesRequestError();
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || url.origin !== value) {
    throw new PagesRequestError();
  }
  return { origin: value };
}

export function validatePagesRequest(request: Request, config: PagesRequestConfig): ValidatedPagesRequest {
  const url = new URL(request.url);
  if (url.origin !== config.origin) throw new PagesRequestError();

  const resume = request.method === 'GET' && url.pathname === SESSION_PATH && url.search === '?resume=1';
  if (resume) {
    requireNoBody(request);
    requireExactOriginIfPresent(request, config);
    return { route: 'resume' };
  }

  requireSameOrigin(request, config);
  if (request.method === 'GET' && url.pathname === SESSION_PATH && !url.search) {
    requireNoBody(request);
    return { route: 'session' };
  }
  if (request.method === 'POST' && url.pathname === ESTIMATE_PATH && !url.search) {
    requireEstimateBody(request);
    return { route: 'estimate' };
  }
  if (request.method === 'POST' && url.pathname === LOGOUT_PATH && !url.search) {
    requireNoBody(request);
    return { route: 'logout' };
  }
  throw new PagesRequestError();
}

function requireSameOrigin(request: Request, config: PagesRequestConfig): void {
  if (request.headers.get('Origin') !== config.origin || request.headers.get('Sec-Fetch-Site') !== 'same-origin') {
    throw new PagesRequestError();
  }
}

function requireExactOriginIfPresent(request: Request, config: PagesRequestConfig): void {
  const origin = request.headers.get('Origin');
  if (origin !== null && origin !== config.origin) throw new PagesRequestError();
}

function requireNoBody(request: Request): void {
  if (request.body !== null || request.headers.has('Content-Type')) throw new PagesRequestError();
  const contentLength = request.headers.get('Content-Length');
  if (contentLength !== null && contentLength !== '0') throw new PagesRequestError();
}

function requireEstimateBody(request: Request): void {
  const contentType = request.headers.get('Content-Type');
  if (!contentType || !/^multipart\/form-data;\s*boundary=.+/i.test(contentType)) throw new PagesRequestError();
  const contentLength = request.headers.get('Content-Length');
  if (!contentLength || !/^(0|[1-9]\d*)$/.test(contentLength) || Number(contentLength) > MAX_ESTIMATE_BYTES) {
    throw new PagesRequestError();
  }
}
