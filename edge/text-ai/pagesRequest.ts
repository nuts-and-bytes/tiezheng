export type TextPagesRoute = 'session' | 'estimate' | 'logout' | 'resume';

export interface TextPagesRequestConfig {
  origin: string;
}

export interface TextPagesRequestEnv {
  PHOTO_AI_PAGES_ORIGIN: string;
}

export interface ValidatedTextPagesRequest {
  route: TextPagesRoute;
}

export class TextPagesRequestError extends Error {
  constructor() {
    super('Invalid Pages request');
  }
}

const EXACT_HTTPS_ORIGIN = /^https:\/\/[a-z0-9.-]+$/;
const SESSION_PATH = '/api/nutrition/text/session';
const ESTIMATE_PATH = '/api/nutrition/text/estimate';
const LOGOUT_PATH = '/api/nutrition/text/logout';
const MAX_ESTIMATE_BYTES = 8_192;
const CANONICAL_POSITIVE_LENGTH = /^[1-9]\d*$/;

export function parseTextPagesRequestConfig(
  env: TextPagesRequestEnv,
): TextPagesRequestConfig {
  const value = env.PHOTO_AI_PAGES_ORIGIN;
  if (!EXACT_HTTPS_ORIGIN.test(value)) throw new TextPagesRequestError();
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.origin !== value
  ) {
    throw new TextPagesRequestError();
  }
  return { origin: value };
}

export function validateTextPagesRequest(
  request: Request,
  config: TextPagesRequestConfig,
): ValidatedTextPagesRequest {
  try {
    const url = new URL(request.url);
    if (
      url.origin !== config.origin ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    ) {
      throw new TextPagesRequestError();
    }
    requireExactRuntimeHostIfPresent(request, config);
    rejectAmbiguousBodyMetadata(request);

    if (
      request.method === 'GET' &&
      url.pathname === SESSION_PATH &&
      url.search === '?resume=1'
    ) {
      requireNoBody(request);
      requireExactOriginIfPresent(request, config);
      return { route: 'resume' };
    }

    if (
      request.method === 'GET' &&
      url.pathname === SESSION_PATH &&
      url.search === ''
    ) {
      requireNoBody(request);
      requireSameOriginSession(request, config);
      return { route: 'session' };
    }

    requireSameOrigin(request, config);
    if (
      request.method === 'POST' &&
      url.pathname === ESTIMATE_PATH &&
      url.search === ''
    ) {
      requireEstimateBody(request);
      return { route: 'estimate' };
    }
    if (
      request.method === 'POST' &&
      url.pathname === LOGOUT_PATH &&
      url.search === ''
    ) {
      requireNoBody(request);
      return { route: 'logout' };
    }
    throw new TextPagesRequestError();
  } catch (error) {
    if (error instanceof TextPagesRequestError) throw error;
    throw new TextPagesRequestError();
  }
}

function requireExactRuntimeHostIfPresent(
  request: Request,
  config: TextPagesRequestConfig,
): void {
  const host = request.headers.get('host');
  if (host === null) return;

  // Fetch URL parsing removes an explicit default :443, so it cannot be recovered
  // from request.url. Web Headers do not expose HTTP/2 :authority; runtimes that
  // preserve the authority surface it as Host. Never substitute x-forwarded-host.
  if (host !== new URL(config.origin).hostname) throw new TextPagesRequestError();
}

function rejectAmbiguousBodyMetadata(request: Request): void {
  if (request.headers.has('transfer-encoding') || request.headers.has('content-encoding')) {
    throw new TextPagesRequestError();
  }
}

function requireSameOrigin(request: Request, config: TextPagesRequestConfig): void {
  if (
    request.headers.get('origin') !== config.origin ||
    request.headers.get('sec-fetch-site') !== 'same-origin'
  ) {
    throw new TextPagesRequestError();
  }
}

function requireSameOriginSession(
  request: Request,
  config: TextPagesRequestConfig,
): void {
  const origin = request.headers.get('origin');
  if (
    (origin !== null && origin !== config.origin) ||
    request.headers.get('sec-fetch-site') !== 'same-origin'
  ) {
    throw new TextPagesRequestError();
  }
}

function requireExactOriginIfPresent(
  request: Request,
  config: TextPagesRequestConfig,
): void {
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== config.origin) throw new TextPagesRequestError();
}

function requireNoBody(request: Request): void {
  if (request.body !== null || request.headers.has('content-type')) {
    throw new TextPagesRequestError();
  }
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null && contentLength !== '0') throw new TextPagesRequestError();
}

function requireEstimateBody(request: Request): void {
  if (request.body === null || request.headers.get('content-type') !== 'application/json') {
    throw new TextPagesRequestError();
  }
  const contentLength = request.headers.get('content-length');
  if (contentLength === null) return;
  if (!CANONICAL_POSITIVE_LENGTH.test(contentLength)) throw new TextPagesRequestError();
  const length = Number(contentLength);
  if (!Number.isSafeInteger(length) || length > MAX_ESTIMATE_BYTES) {
    throw new TextPagesRequestError();
  }
}
