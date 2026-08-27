import { describe, expect, test } from 'vitest';

import {
  TextPagesRequestError,
  parseTextPagesRequestConfig,
  validateTextPagesRequest,
} from './pagesRequest';

const ORIGIN = 'https://app.example.test';
const config = parseTextPagesRequestConfig({ PHOTO_AI_PAGES_ORIGIN: ORIGIN });
const loginUrl = `${ORIGIN}/api/nutrition/text/login`;
const sessionUrl = `${ORIGIN}/api/nutrition/text/session`;
const estimateUrl = `${ORIGIN}/api/nutrition/text/estimate`;
const logoutUrl = `${ORIGIN}/api/nutrition/text/logout`;

function request(url = sessionUrl, init: RequestInit = {}): Request {
  return new Request(url, init);
}

function sameOriginHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers({
    origin: ORIGIN,
    'sec-fetch-site': 'same-origin',
  });
  new Headers(extra).forEach((value, key) => headers.set(key, value));
  return headers;
}

function syntheticRequest(
  url: string,
  method: string,
  headers: HeadersInit = {},
  body: ReadableStream<Uint8Array> | null = null,
): Request {
  return { url, method, headers: new Headers(headers), body } as Request;
}

function jsonBody(value = '{}'): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

describe('parseTextPagesRequestConfig', () => {
  test('accepts only one exact lower-case HTTPS origin without a port', () => {
    expect(config).toEqual({ origin: ORIGIN });
  });

  test.each([
    '',
    'http://app.example.test',
    'HTTPS://app.example.test',
    'https://APP.example.test',
    'https://user@app.example.test',
    'https://user:pass@app.example.test',
    'https://app.example.test/path',
    'https://app.example.test/',
    'https://app.example.test?x=1',
    'https://app.example.test#hash',
    'https://app.example.test:443',
    'https://app.example.test:8443',
    'https://*.example.test',
    'https://app_example.test',
  ])('rejects invalid origin config %#', (origin) => {
    expect(() => parseTextPagesRequestConfig({
      PHOTO_AI_PAGES_ORIGIN: origin,
    })).toThrow(TextPagesRequestError);
  });
});

describe('validateTextPagesRequest', () => {
  test('accepts an ordinary same-origin session GET when Origin is omitted', () => {
    expect(validateTextPagesRequest(request(sessionUrl, {
      headers: { 'sec-fetch-site': 'same-origin' },
    }), config)).toEqual({ route: 'session' });
    expect(validateTextPagesRequest(request(sessionUrl, {
      headers: {
        origin: ORIGIN,
        'sec-fetch-site': 'same-origin',
      },
    }), config)).toEqual({ route: 'session' });
  });

  test('accepts the exact Host when the runtime exposes authoritative host metadata', () => {
    expect(validateTextPagesRequest(request(sessionUrl, {
      headers: {
        host: 'app.example.test',
        'sec-fetch-site': 'same-origin',
      },
    }), config)).toEqual({ route: 'session' });
  });

  test.each([
    'app.example.test:443',
    'app.example.test:8443',
    'evil.example.test',
    'user@app.example.test',
  ])('rejects a port, credentials or mismatch in an exposed Host header: %s', (host) => {
    expect(() => validateTextPagesRequest(request(sessionUrl, {
      headers: {
        host,
        'sec-fetch-site': 'same-origin',
      },
    }), config)).toThrow(TextPagesRequestError);
  });

  test('does not trust x-forwarded-host when authoritative Host is unavailable', () => {
    expect(validateTextPagesRequest(request(sessionUrl, {
      headers: {
        'sec-fetch-site': 'same-origin',
        'x-forwarded-host': 'app.example.test:443',
      },
    }), config)).toEqual({ route: 'session' });
  });

  test('documents that standard Request normalization makes an explicit default port unobservable', () => {
    const normalized = request(
      'https://app.example.test:443/api/nutrition/text/session',
      { headers: { 'sec-fetch-site': 'same-origin' } },
    );
    expect(normalized.url).toBe(sessionUrl);
    expect(normalized.headers.get('host')).toBeNull();
    expect(validateTextPagesRequest(normalized, config)).toEqual({ route: 'session' });
  });

  test('accepts same-origin JSON login with or without a bounded Content-Length', () => {
    const withoutLength = request(loginUrl, {
      method: 'POST',
      headers: sameOriginHeaders({ 'content-type': 'application/json' }),
      body: '{}',
    });
    expect(validateTextPagesRequest(withoutLength, config)).toEqual({ route: 'login' });

    for (const contentLength of ['1', '512']) {
      const bounded = request(loginUrl, {
        method: 'POST',
        headers: sameOriginHeaders({
          'content-length': contentLength,
          'content-type': 'application/json',
        }),
        body: '{}',
      });
      expect(validateTextPagesRequest(bounded, config)).toEqual({ route: 'login' });
    }
  });

  test('accepts same-origin JSON estimates with or without Content-Length', () => {
    const withoutLength = request(estimateUrl, {
      method: 'POST',
      headers: sameOriginHeaders({ 'content-type': 'application/json' }),
      body: '{}',
    });
    expect(validateTextPagesRequest(withoutLength, config)).toEqual({ route: 'estimate' });

    for (const contentLength of ['1', '8192']) {
      const bounded = request(estimateUrl, {
        method: 'POST',
        headers: sameOriginHeaders({
          'content-length': contentLength,
          'content-type': 'application/json',
        }),
        body: '{}',
      });
      expect(validateTextPagesRequest(bounded, config)).toEqual({ route: 'estimate' });
    }
  });

  test('accepts a same-origin bodyless logout POST', () => {
    expect(validateTextPagesRequest(request(logoutUrl, {
      method: 'POST',
      headers: sameOriginHeaders(),
    }), config)).toEqual({ route: 'logout' });
    expect(validateTextPagesRequest(request(logoutUrl, {
      method: 'POST',
      headers: sameOriginHeaders({ 'content-length': '0' }),
    }), config)).toEqual({ route: 'logout' });
  });

  test.each([
    ['preview host', 'https://tiezheng.pages.dev/api/nutrition/text/session'],
    ['other host', 'https://evil.example.test/api/nutrition/text/session'],
    ['HTTP', 'http://app.example.test/api/nutrition/text/session'],
    ['port', 'https://app.example.test:8443/api/nutrition/text/session'],
    ['path suffix', `${sessionUrl}/extra`],
    ['encoded path', `${ORIGIN}/api/nutrition/text/%73ession`],
    ['case drift', `${ORIGIN}/api/nutrition/text/Session`],
    ['fragment-normalized query', `${sessionUrl}?x=1`],
    ['removed resume query', `${sessionUrl}?resume=1`],
  ])('rejects request URL drift: %s', (_case, url) => {
    expect(() => validateTextPagesRequest(syntheticRequest(
      url,
      'GET',
      { 'sec-fetch-site': 'same-origin' },
    ), config)).toThrow(TextPagesRequestError);
  });

  test.each([
    [loginUrl, 'POST', sameOriginHeaders({ 'content-type': 'application/json' }), jsonBody()],
    [sessionUrl, 'GET', { 'sec-fetch-site': 'same-origin' }, null],
    [estimateUrl, 'POST', sameOriginHeaders({ 'content-type': 'application/json' }), jsonBody()],
    [logoutUrl, 'POST', sameOriginHeaders(), null],
  ] as const)(
    'rejects even an empty query delimiter: %s',
    (url, method, headers, body) => {
      expect(() => validateTextPagesRequest(
        syntheticRequest(`${url}?`, method, headers, body),
        config,
      )).toThrow(TextPagesRequestError);
    },
  );

  test.each([
    ['login GET', loginUrl, 'GET'],
    ['login PUT', loginUrl, 'PUT'],
    ['session POST', sessionUrl, 'POST'],
    ['estimate GET', estimateUrl, 'GET'],
    ['estimate PUT', estimateUrl, 'PUT'],
    ['logout GET', logoutUrl, 'GET'],
    ['logout DELETE', logoutUrl, 'DELETE'],
    ['unknown path', `${ORIGIN}/api/nutrition/text/private`, 'GET'],
    ['photo path', `${ORIGIN}/api/nutrition/photo/session`, 'GET'],
  ])('rejects a closed-world route/method mismatch: %s', (_case, url, method) => {
    expect(() => validateTextPagesRequest(syntheticRequest(
      url,
      method,
      sameOriginHeaders({ 'content-type': 'application/json' }),
    ), config)).toThrow(TextPagesRequestError);
  });

  test.each([
    ['missing site', { origin: ORIGIN }],
    ['missing origin', { 'sec-fetch-site': 'same-origin' }],
    ['cross origin', { origin: 'https://evil.example.test', 'sec-fetch-site': 'same-origin' }],
    ['wildcard-like origin', { origin: 'https://evil.app.example.test', 'sec-fetch-site': 'same-origin' }],
    ['suffix origin', { origin: 'https://app.example.test.evil.test', 'sec-fetch-site': 'same-origin' }],
    ['port origin', { origin: 'https://app.example.test:8443', 'sec-fetch-site': 'same-origin' }],
    ['cross-site', { origin: ORIGIN, 'sec-fetch-site': 'cross-site' }],
    ['same-site', { origin: ORIGIN, 'sec-fetch-site': 'same-site' }],
    ['none', { origin: ORIGIN, 'sec-fetch-site': 'none' }],
  ])('rejects unsafe estimate fetch metadata: %s', (_case, headers) => {
    expect(() => validateTextPagesRequest(request(estimateUrl, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: '{}',
    }), config)).toThrow(TextPagesRequestError);
  });

  test.each([
    ['missing site', { origin: ORIGIN }],
    ['missing origin', { 'sec-fetch-site': 'same-origin' }],
    ['wrong origin', { origin: 'https://evil.example.test', 'sec-fetch-site': 'same-origin' }],
    ['cross-site', { origin: ORIGIN, 'sec-fetch-site': 'cross-site' }],
  ])('rejects unsafe login fetch metadata: %s', (_case, headers) => {
    expect(() => validateTextPagesRequest(request(loginUrl, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: '{}',
    }), config)).toThrow(TextPagesRequestError);
  });

  test.each([
    ['missing site', {}],
    ['cross-site', { 'sec-fetch-site': 'cross-site' }],
    ['same-site', { 'sec-fetch-site': 'same-site' }],
    ['wrong origin', { origin: 'https://evil.example.test', 'sec-fetch-site': 'same-origin' }],
  ])('rejects unsafe ordinary session metadata: %s', (_case, headers) => {
    expect(() => validateTextPagesRequest(request(sessionUrl, { headers }), config)).toThrow(
      TextPagesRequestError,
    );
  });

  test.each([
    null,
    'Application/json',
    'application/JSON',
    'application/json; charset=utf-8',
    'text/json',
    'text/plain',
    'multipart/form-data; boundary=a',
  ])('rejects non-exact estimate Content-Type %#', (contentType) => {
    const headers = sameOriginHeaders();
    if (contentType !== null) headers.set('content-type', contentType);
    expect(() => validateTextPagesRequest(request(estimateUrl, {
      method: 'POST',
      headers,
      body: '{}',
    }), config)).toThrow(TextPagesRequestError);
  });

  test.each([
    null,
    'Application/json',
    'application/json; charset=utf-8',
    'text/plain',
  ])('rejects non-exact login Content-Type %#', (contentType) => {
    const headers = sameOriginHeaders();
    if (contentType !== null) headers.set('content-type', contentType);
    expect(() => validateTextPagesRequest(request(loginUrl, {
      method: 'POST',
      headers,
      body: '{}',
    }), config)).toThrow(TextPagesRequestError);
  });

  test.each([
    '0',
    '8193',
    '01',
    '+1',
    '-1',
    '1.0',
    '1e3',
    '1, 1',
    '9007199254740993',
  ])('rejects a non-canonical or out-of-range Content-Length: %s', (contentLength) => {
    expect(() => validateTextPagesRequest(request(estimateUrl, {
      method: 'POST',
      headers: sameOriginHeaders({
        'content-length': contentLength,
        'content-type': 'application/json',
      }),
      body: '{}',
    }), config)).toThrow(TextPagesRequestError);
  });

  test.each(['0', '513', '0512', '+1', '1.0', '9007199254740993'])(
    'rejects a non-canonical or oversized login Content-Length: %s',
    (contentLength) => {
      expect(() => validateTextPagesRequest(request(loginUrl, {
        method: 'POST',
        headers: sameOriginHeaders({
          'content-length': contentLength,
          'content-type': 'application/json',
        }),
        body: '{}',
      }), config)).toThrow(TextPagesRequestError);
    },
  );

  test('rejects an estimate without a body even if headers claim bytes', () => {
    expect(() => validateTextPagesRequest(request(estimateUrl, {
      method: 'POST',
      headers: sameOriginHeaders({
        'content-length': '1',
        'content-type': 'application/json',
      }),
    }), config)).toThrow(TextPagesRequestError);
  });

  test('rejects a login without a body even if headers claim bytes', () => {
    expect(() => validateTextPagesRequest(request(loginUrl, {
      method: 'POST',
      headers: sameOriginHeaders({
        'content-length': '1',
        'content-type': 'application/json',
      }),
    }), config)).toThrow(TextPagesRequestError);
  });

  test.each([
    ['transfer-encoding only', { 'transfer-encoding': 'chunked' }],
    ['TE plus CL', { 'content-length': '2', 'transfer-encoding': 'chunked' }],
    ['content encoding', { 'content-encoding': 'gzip' }],
  ])('rejects request-smuggling or encoded-body metadata: %s', (_case, extra) => {
    expect(() => validateTextPagesRequest(request(estimateUrl, {
      method: 'POST',
      headers: sameOriginHeaders({
        ...extra,
        'content-type': 'application/json',
      }),
      body: '{}',
    }), config)).toThrow(TextPagesRequestError);
  });

  test.each([
    ['session body', sessionUrl, 'GET', { body: 'x' }],
    ['session content type', sessionUrl, 'GET', { headers: { 'content-type': 'application/json' } }],
    ['session positive length', sessionUrl, 'GET', { headers: { 'content-length': '1' } }],
    ['logout body', logoutUrl, 'POST', { body: 'x' }],
    ['logout content type', logoutUrl, 'POST', { headers: { 'content-type': 'application/json' } }],
    ['logout positive length', logoutUrl, 'POST', { headers: { 'content-length': '1' } }],
  ])('rejects body metadata on a bodyless route: %s', (_case, url, method, partial) => {
    const extraHeaders = 'headers' in partial && partial.headers !== undefined
      ? partial.headers
      : {};
    const headers = method === 'POST'
      ? sameOriginHeaders(extraHeaders)
      : new Headers({ 'sec-fetch-site': 'same-origin', ...extraHeaders });
    const body = 'body' in partial && partial.body !== undefined
      ? new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(partial.body));
          controller.close();
        },
      })
      : null;
    expect(() => validateTextPagesRequest(
      syntheticRequest(url, method, headers, body),
      config,
    )).toThrow(TextPagesRequestError);
  });

  test('always returns the fixed request error message', () => {
    try {
      validateTextPagesRequest(request(`${ORIGIN}/private`), config);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(TextPagesRequestError);
      expect((error as Error).message).toBe('Invalid Pages request');
    }
  });
});
