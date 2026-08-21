import { describe, expect, test } from 'vitest';
import { PagesRequestError, parsePagesRequestConfig, validatePagesRequest } from './pagesRequest';

const config = parsePagesRequestConfig({ PHOTO_AI_PAGES_ORIGIN: 'https://app.example.test' });
const sessionUrl = 'https://app.example.test/api/nutrition/photo/session';

function request(url = sessionUrl, init: RequestInit = {}) {
  return new Request(url, init);
}

describe('parsePagesRequestConfig', () => {
  test.each([
    'http://app.example.test',
    'https://user@app.example.test',
    'https://app.example.test/path',
    'https://app.example.test?x=1',
    'https://app.example.test#hash',
    'https://app.example.test:8443',
  ])('rejects a non-exact https origin: %s', (origin) => {
    expect(() => parsePagesRequestConfig({ PHOTO_AI_PAGES_ORIGIN: origin })).toThrow(PagesRequestError);
  });
});

describe('validatePagesRequest', () => {
  test('accepts a same-origin session GET when browsers omit Origin', () => {
    expect(validatePagesRequest(request(sessionUrl, { headers: { 'Sec-Fetch-Site': 'same-origin' } }), config)).toEqual({ route: 'session' });
    expect(validatePagesRequest(request(sessionUrl, { headers: { Origin: config.origin, 'Sec-Fetch-Site': 'same-origin' } }), config)).toEqual({ route: 'session' });
  });

  test.each([
    ['Pages preview host', 'https://tiezheng.pages.dev/api/nutrition/photo/session'],
    ['wildcard-like origin', sessionUrl, { Origin: 'https://evil.app.example.test' }],
    ['http origin', sessionUrl, { Origin: 'http://app.example.test' }],
    ['userinfo origin', sessionUrl, { Origin: 'https://user@app.example.test' }],
    ['port origin', sessionUrl, { Origin: 'https://app.example.test:8443' }],
    ['suffix origin', sessionUrl, { Origin: 'https://app.example.test.evil.example' }],
  ])('rejects %s', (_name, url, headers?: HeadersInit) => {
    expect(() => validatePagesRequest(request(url, { headers: headers ?? { Origin: config.origin } }), config)).toThrow(PagesRequestError);
  });

  test('rejects missing or cross-site fetch metadata', () => {
    expect(() => validatePagesRequest(request(sessionUrl), config)).toThrow(PagesRequestError);
    expect(() => validatePagesRequest(request(sessionUrl, { headers: { 'Sec-Fetch-Site': 'cross-site' } }), config)).toThrow(PagesRequestError);
    expect(() => validatePagesRequest(request(sessionUrl, { headers: { Origin: config.origin, 'Sec-Fetch-Site': 'cross-site' } }), config)).toThrow(PagesRequestError);
    expect(() => validatePagesRequest(request(sessionUrl, { headers: { Origin: config.origin, 'Sec-Fetch-Site': 'same-site' } }), config)).toThrow(PagesRequestError);
  });

  test('requires each supported route to have its closed-world method and body shape', () => {
    expect(() => validatePagesRequest(request(sessionUrl, { method: 'POST', headers: { Origin: config.origin } }), config)).toThrow(PagesRequestError);
    expect(() => validatePagesRequest(request(sessionUrl, { headers: { Origin: config.origin, 'Content-Length': '1' } }), config)).toThrow(PagesRequestError);
    expect(() => validatePagesRequest(request('https://app.example.test/api/nutrition/photo/estimate', { method: 'POST', headers: { Origin: config.origin } }), config)).toThrow(PagesRequestError);
    expect(() => validatePagesRequest(request('https://app.example.test/api/nutrition/photo/estimate', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json', 'Content-Length': '1' }, body: 'x' }), config)).toThrow(PagesRequestError);
    expect(() => validatePagesRequest(request('https://app.example.test/api/nutrition/photo/estimate', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'multipart/form-data; boundary=a', 'Content-Length': '1100001' }, body: 'x' }), config)).toThrow(PagesRequestError);
    expect(() => validatePagesRequest(request('https://app.example.test/api/nutrition/photo/logout', { method: 'POST', headers: { Origin: config.origin, 'Content-Length': '1' }, body: 'x' }), config)).toThrow(PagesRequestError);
  });

  test('accepts a bounded multipart estimate only from the exact same origin', () => {
    const estimate = request('https://app.example.test/api/nutrition/photo/estimate', {
      method: 'POST',
      headers: {
        Origin: config.origin,
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'multipart/form-data; boundary=a',
        'Content-Length': '1100000',
      },
      body: 'x',
    });
    expect(validatePagesRequest(estimate, config)).toEqual({ route: 'estimate' });
  });

  test('allows only the exact-host resume navigation exception and ignores return parameters', () => {
    expect(validatePagesRequest(request(`${sessionUrl}?resume=1`, { headers: { 'Sec-Fetch-Site': 'cross-site' } }), config)).toEqual({ route: 'resume' });
    expect(() => validatePagesRequest(request('https://evil.example/api/nutrition/photo/session?resume=1'), config)).toThrow(PagesRequestError);
    expect(() => validatePagesRequest(request(`${sessionUrl}?resume=1&return=https://evil.example`), config)).toThrow(PagesRequestError);
  });
});
