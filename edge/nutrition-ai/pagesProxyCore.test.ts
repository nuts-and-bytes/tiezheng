import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  proxyBoundedJson,
  type JsonProxyDefinition,
} from './pagesProxyCore';

const ACCOUNT_KEY = 'a'.repeat(64);

const sessionDefinition: JsonProxyDefinition<{ ok: true }> = {
  downstreamPath: '/text/session',
  method: 'GET',
  parse(value) {
    if (JSON.stringify(value) !== '{"ok":true}') throw new TypeError('private parser detail');
    return { ok: true };
  },
  expectedStatus: () => 200,
  requestBodyLimit: null,
};

const textEstimateDefinition: JsonProxyDefinition<{ ok: true }> = {
  ...sessionDefinition,
  downstreamPath: '/text/estimate',
  method: 'POST',
  requestBodyLimit: 8_192,
};

const photoEstimateDefinition: JsonProxyDefinition<{ ok: true }> = {
  ...sessionDefinition,
  downstreamPath: '/estimate',
  method: 'POST',
  requestBodyLimit: 1_100_000,
};

function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

function binding(fetcher: Fetcher['fetch']): Fetcher {
  return { fetch: fetcher } as Fetcher;
}

function headerRecord(init?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {};
  new Headers(init).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function streamingRequest(
  stream: ReadableStream<Uint8Array>,
  headers: HeadersInit,
): Request {
  return new Request('https://app.example.test/api/nutrition/text/estimate', {
    method: 'POST',
    headers,
    body: stream,
    duplex: 'half',
  } as RequestInit);
}

function chunkStream(
  chunks: readonly unknown[],
  cancel: (reason?: unknown) => void | PromiseLike<void> = vi.fn(),
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk as Uint8Array);
      controller.close();
    },
    cancel,
  });
}

function pendingStream(
  chunks: readonly unknown[] = [],
  cancel: (reason?: unknown) => void | PromiseLike<void> = vi.fn(),
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk as Uint8Array);
    },
    cancel,
  });
}

interface FrameLike {
  contentWindow: { Uint8Array: Uint8ArrayConstructor } | null;
  remove(): void;
}

interface DocumentLike {
  body: { append(value: unknown): void };
  createElement(name: string): FrameLike;
}

function crossRealmBytes(values: readonly number[]): Uint8Array {
  const documentLike = (globalThis as unknown as { document?: DocumentLike }).document;
  if (documentLike === undefined) return new Uint8Array(values);
  const frame = documentLike.createElement('iframe');
  documentLike.body.append(frame);
  const ForeignUint8Array = frame.contentWindow?.Uint8Array;
  if (ForeignUint8Array === undefined) {
    frame.remove();
    throw new TypeError('test iframe unavailable');
  }
  const bytes = new ForeignUint8Array(values);
  frame.remove();
  return bytes;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('proxyBoundedJson', () => {
  test('starts the 18 second text deadline before reading a stalled POST body', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    let close!: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{'));
        close = () => controller.close();
      },
      cancel,
    });
    const fetcher = vi.fn(async () => json({ ok: true }));
    let outcome: 'resolved' | 'rejected' | undefined;
    const pending = proxyBoundedJson(
      streamingRequest(stream, { 'content-type': 'application/json' }),
      binding(fetcher),
      ACCOUNT_KEY,
      textEstimateDefinition,
    );
    void pending.then(
      () => { outcome = 'resolved'; },
      () => { outcome = 'rejected'; },
    );

    try {
      await vi.advanceTimersByTimeAsync(18_000);
      expect(outcome).toBe('rejected');
      await expect(pending).rejects.toThrow('Invalid service response');
      expect(fetcher).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(stream.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      if (outcome === undefined) close();
      await vi.runAllTimersAsync();
      await pending.catch(() => undefined);
    }
  });

  test.each([
    ['throws synchronously', () => { throw new Error('cancel failed'); }],
    ['rejects', () => Promise.reject(new Error('cancel failed'))],
  ])('pre-aborted text POST releases its body when reader cancellation %s', async (
    _label,
    cancelImplementation,
  ) => {
    vi.useFakeTimers();
    const caller = new AbortController();
    caller.abort();
    let close!: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        close = () => controller.close();
      },
    });
    const request = streamingRequest(stream, { 'content-type': 'application/json' });
    Object.defineProperty(request, 'signal', { configurable: true, value: caller.signal });
    const cancelReader = vi.spyOn(ReadableStreamDefaultReader.prototype, 'cancel')
      .mockImplementation(cancelImplementation);
    const fetcher = vi.fn();
    let outcome: 'resolved' | 'rejected' | undefined;
    const pending = proxyBoundedJson(
      request,
      binding(fetcher),
      ACCOUNT_KEY,
      textEstimateDefinition,
    );
    void pending.then(
      () => { outcome = 'resolved'; },
      () => { outcome = 'rejected'; },
    );

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(outcome).toBe('rejected');
      await expect(pending).rejects.toThrow('Invalid service response');
      expect(fetcher).not.toHaveBeenCalled();
      expect(cancelReader).toHaveBeenCalledTimes(1);
      expect(stream.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      cancelReader.mockRestore();
      if (outcome === undefined) close();
      await vi.runAllTimersAsync();
      await pending.catch(() => undefined);
    }
  });

  test('aborts and unlocks a stalled text binding response at the same 18 second deadline', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    let close!: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        close = () => controller.close();
      },
      cancel,
    });
    const fetcher = vi.fn(async () => new Response(stream, {
      headers: { 'content-type': 'application/json' },
    }));
    const pending = proxyBoundedJson(
      new Request('https://app.example.test/api/nutrition/text/session'),
      binding(fetcher),
      ACCOUNT_KEY,
      sessionDefinition,
    );
    void pending.catch(() => undefined);

    try {
      await vi.advanceTimersByTimeAsync(18_000);
      await expect(pending).rejects.toThrow('Invalid service response');
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(stream.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      if (stream.locked) close();
      await Promise.resolve();
    }
  });

  test('gives text service bindings an 18 second deadline below the 20 second client ceiling', async () => {
    vi.useFakeTimers();
    let forwardedSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      forwardedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        forwardedSignal?.addEventListener('abort', () => {
          reject(new DOMException('binding aborted', 'AbortError'));
        }, { once: true });
      });
    });
    const pending = proxyBoundedJson(
      new Request('https://app.example.test/api/nutrition/text/session'),
      binding(fetcher),
      ACCOUNT_KEY,
      sessionDefinition,
    );
    let settled = false;
    void pending.finally(() => { settled = true; }).catch(() => undefined);

    await vi.advanceTimersByTimeAsync(17_999);
    expect(settled).toBe(false);
    expect(forwardedSignal).toBeInstanceOf(AbortSignal);
    expect(forwardedSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).rejects.toThrow('Invalid service response');
    expect(forwardedSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('propagates a caller abort through a distinct text binding signal and cleans listeners', async () => {
    let callerAborted = false;
    const callerListeners = new Set<EventListenerOrEventListenerObject>();
    const callerSignal = {
      get aborted() { return callerAborted; },
      addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'abort') callerListeners.add(listener);
      }),
      removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'abort') callerListeners.delete(listener);
      }),
    } as unknown as AbortSignal;
    const request = new Request('https://app.example.test/api/nutrition/text/session');
    Object.defineProperty(request, 'signal', { configurable: true, value: callerSignal });
    let forwardedSignal: AbortSignal | undefined;
    let rejectBinding!: (error: unknown) => void;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      forwardedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        rejectBinding = reject;
        forwardedSignal?.addEventListener('abort', () => {
          reject(new DOMException('binding aborted', 'AbortError'));
        }, { once: true });
      });
    });
    const pending = proxyBoundedJson(
      request,
      binding(fetcher),
      ACCOUNT_KEY,
      sessionDefinition,
    );

    try {
      await Promise.resolve();
      expect(forwardedSignal).not.toBe(callerSignal);
      callerAborted = true;
      for (const listener of [...callerListeners]) {
        if (typeof listener === 'function') listener.call(callerSignal, new Event('abort'));
        else listener.handleEvent(new Event('abort'));
      }
      await expect(pending).rejects.toThrow('Invalid service response');
      expect(forwardedSignal?.aborted).toBe(true);
      expect(callerSignal.addEventListener).toHaveBeenCalledWith(
        'abort',
        expect.any(Function),
        { once: true },
      );
      expect(callerSignal.removeEventListener).toHaveBeenCalledWith(
        'abort',
        expect.any(Function),
      );
    } finally {
      rejectBinding(new DOMException('test cleanup', 'AbortError'));
      await pending.catch(() => undefined);
    }
  });

  test('does not start a text binding when the caller is already aborted', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    caller.abort();
    const fetcher = vi.fn(async () => json({ ok: true }));
    const request = new Request('https://app.example.test/api/nutrition/text/session');
    Object.defineProperty(request, 'signal', {
      configurable: true,
      value: caller.signal,
    });

    await expect(proxyBoundedJson(
      request,
      binding(fetcher),
      ACCOUNT_KEY,
      sessionDefinition,
    )).rejects.toThrow('Invalid service response');

    expect(fetcher).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('does not add a text deadline signal to the shared photo binding', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeUndefined();
      return json({ ok: true });
    });
    const request = new Request('https://app.example.test/api/nutrition/photo/estimate', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=safe' },
      body: 'abc',
    });

    await expect(proxyBoundedJson(
      request,
      binding(fetcher),
      ACCOUNT_KEY,
      photoEstimateDefinition,
    )).resolves.toEqual({ body: { ok: true }, status: 200 });
  });

  test('uses only the fixed internal target, method and validated account header', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://photo-ai-gateway.internal/text/session');
      expect(init?.method).toBe('GET');
      expect(init?.redirect).toBe('manual');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.body).toBeUndefined();
      expect(headerRecord(init?.headers)).toEqual({
        'x-tiezheng-account-key': ACCOUNT_KEY,
      });
      return json({ ok: true });
    });
    const request = new Request(
      'https://evil.example.test/redirect?target=https://attacker.test',
      {
        headers: {
          authorization: 'private-jwt',
          cookie: 'private-cookie',
          'cf-access-jwt-assertion': 'private-access-token',
          host: 'attacker.test',
          origin: 'https://evil.example.test',
          'sec-fetch-site': 'cross-site',
          'x-tiezheng-account-key': 'b'.repeat(64),
        },
      },
    );

    await expect(proxyBoundedJson(
      request,
      binding(fetcher),
      ACCOUNT_KEY,
      sessionDefinition,
    )).resolves.toEqual({ body: { ok: true }, status: 200 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('uses manual redirects and rejects a 3xx without following or leaking it', async () => {
    const cancel = vi.fn();
    const downstream = new Response(pendingStream([
      new TextEncoder().encode('{"private":"redirect-body"}'),
    ], cancel), {
      status: 302,
      headers: {
        'content-type': 'application/json',
        location: 'https://evil.example.test/private-location',
      },
    });
    let forwarded: Request | null = null;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      forwarded = new Request(String(input), { ...init, signal: undefined });
      return downstream;
    });

    const operation = proxyBoundedJson(
      new Request('https://app.example.test/api/nutrition/text/session'),
      binding(fetcher),
      ACCOUNT_KEY,
      sessionDefinition,
    );
    const error = await operation.catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe('Invalid service response');
    expect((error as Error).message).not.toMatch(/evil|redirect-body|private-location/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(forwarded).not.toBeNull();
    expect((forwarded as unknown as Request).redirect).toBe('manual');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(downstream.body?.locked).toBe(false);
  });

  test('copies a text JSON body and derives Content-Length from actual bytes', async () => {
    const source = new Request('https://app.example.test/private?forward=evil', {
      method: 'POST',
      headers: {
        authorization: 'private-jwt',
        'content-length': '1',
        'content-type': 'application/json',
        cookie: 'private-cookie',
        origin: 'https://app.example.test',
        'sec-fetch-site': 'same-origin',
      },
      body: 'abc',
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://photo-ai-gateway.internal/text/estimate');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeInstanceOf(Uint8Array);
      expect(init?.body).not.toBe(source.body);
      expect(headerRecord(init?.headers)).toEqual({
        'content-length': '3',
        'content-type': 'application/json',
        'x-tiezheng-account-key': ACCOUNT_KEY,
      });
      expect(await new Response(init?.body).text()).toBe('abc');
      return json({ ok: true });
    });

    await expect(proxyBoundedJson(
      source,
      binding(fetcher),
      ACCOUNT_KEY,
      textEstimateDefinition,
    )).resolves.toEqual({ body: { ok: true }, status: 200 });
    expect(source.bodyUsed).toBe(true);
  });

  test('accepts cross-realm Uint8Array chunks on both request and response', async () => {
    const request = streamingRequest(chunkStream([
      crossRealmBytes([123]),
      crossRealmBytes([125]),
    ]), { 'content-type': 'application/json' });
    const fetcher = vi.fn(async () => new Response(chunkStream([
      crossRealmBytes([123, 34, 111, 107]),
      crossRealmBytes([34, 58, 116, 114, 117, 101, 125]),
    ]), { headers: { 'content-type': 'application/json' } }));

    await expect(proxyBoundedJson(
      request,
      binding(fetcher),
      ACCOUNT_KEY,
      textEstimateDefinition,
    )).resolves.toEqual({ body: { ok: true }, status: 200 });
  });

  test.each([
    ['DataView', new DataView(new ArrayBuffer(1))],
    ['other typed array', new Int8Array([1])],
    ['forged toStringTag', {
      byteLength: 1,
      slice: vi.fn(() => new Uint8Array([1])),
      [Symbol.toStringTag]: 'Uint8Array',
    }],
  ])('rejects an unbranded request chunk and cancels it: %s', async (_case, chunk) => {
    const cancelReader = vi.spyOn(ReadableStreamDefaultReader.prototype, 'cancel');
    const request = streamingRequest(
      chunkStream([chunk]),
      { 'content-type': 'application/json' },
    );
    const fetcher = vi.fn();

    await expect(proxyBoundedJson(
      request,
      binding(fetcher),
      ACCOUNT_KEY,
      textEstimateDefinition,
    )).rejects.toThrow('Invalid service response');
    expect(cancelReader).toHaveBeenCalledTimes(1);
    expect(request.body?.locked).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test.each([
    ['DataView', new DataView(new ArrayBuffer(1))],
    ['other typed array', new Uint16Array([1])],
    ['forged toStringTag', {
      byteLength: 1,
      slice: vi.fn(() => new Uint8Array([1])),
      [Symbol.toStringTag]: 'Uint8Array',
    }],
  ])('rejects an unbranded response chunk and cancels it: %s', async (_case, chunk) => {
    const cancelReader = vi.spyOn(ReadableStreamDefaultReader.prototype, 'cancel');
    const downstream = new Response(chunkStream([chunk]), {
      headers: { 'content-type': 'application/json' },
    });

    await expect(proxyBoundedJson(
      new Request('https://app.example.test/api/nutrition/text/session'),
      binding(vi.fn(async () => downstream)),
      ACCOUNT_KEY,
      sessionDefinition,
    )).rejects.toThrow('Invalid service response');
    expect(cancelReader).toHaveBeenCalledTimes(1);
    expect(downstream.body?.locked).toBe(false);
  });

  test('uses intrinsic copying instead of attacker-controlled chunk methods', async () => {
    const requestChunk = new Uint8Array([123, 125]);
    const requestSlice = vi.fn(() => {
      throw new Error('private request slice');
    });
    Object.defineProperty(requestChunk, 'slice', { value: requestSlice });
    const responseChunk = new Uint8Array(new TextEncoder().encode('{"ok":true}'));
    const responseSlice = vi.fn(() => {
      throw new Error('private response slice');
    });
    Object.defineProperty(responseChunk, 'slice', { value: responseSlice });

    await expect(proxyBoundedJson(
      streamingRequest(chunkStream([requestChunk]), { 'content-type': 'application/json' }),
      binding(vi.fn(async () => new Response(chunkStream([responseChunk]), {
        headers: { 'content-type': 'application/json' },
      }))),
      ACCOUNT_KEY,
      textEstimateDefinition,
    )).resolves.toEqual({ body: { ok: true }, status: 200 });
    expect(requestSlice).not.toHaveBeenCalled();
    expect(responseSlice).not.toHaveBeenCalled();
  });

  test.each([
    ['request', 'request'],
    ['response', 'response'],
  ])('cancels and releases the %s stream when an intrinsic copy fails', async (_case, side) => {
    const request = streamingRequest(
      chunkStream([new Uint8Array([123, 125])]),
      { 'content-type': 'application/json' },
    );
    const downstream = new Response(
      chunkStream([new TextEncoder().encode('{"ok":true}')]),
      { headers: { 'content-type': 'application/json' } },
    );
    const cancelReader = vi.spyOn(ReadableStreamDefaultReader.prototype, 'cancel');
    const intrinsicApply = Reflect.apply;
    vi.spyOn(Reflect, 'apply').mockImplementation((target, thisArgument, argumentsList) => {
      if (target === Uint8Array.prototype.set) throw new Error('private copy detail');
      return intrinsicApply(target, thisArgument, argumentsList);
    });

    const operation = side === 'request'
      ? proxyBoundedJson(request, binding(vi.fn()), ACCOUNT_KEY, textEstimateDefinition)
      : proxyBoundedJson(
        new Request('https://app.example.test/api/nutrition/text/session'),
        binding(vi.fn(async () => downstream)),
        ACCOUNT_KEY,
        sessionDefinition,
      );

    await expect(operation).rejects.toThrow('Invalid service response');
    await expect(operation).rejects.not.toThrow('private copy detail');
    expect(cancelReader).toHaveBeenCalledTimes(1);
    expect((side === 'request' ? request.body : downstream.body)?.locked).toBe(false);
  });

  test.each([
    ['request', 'request'],
    ['response', 'response'],
  ])('rejects a zero-byte chunk immediately on the %s side', async (_case, side) => {
    const cancelReader = vi.spyOn(ReadableStreamDefaultReader.prototype, 'cancel');
    const requestChunks = side === 'request'
      ? [new Uint8Array(0), new Uint8Array([123, 125])]
      : [new Uint8Array([123, 125])];
    const responseChunks = side === 'response'
      ? [new Uint8Array(0), new TextEncoder().encode('{"ok":true}')]
      : [new TextEncoder().encode('{"ok":true}')];

    await expect(proxyBoundedJson(
      streamingRequest(chunkStream(requestChunks), { 'content-type': 'application/json' }),
      binding(vi.fn(async () => new Response(chunkStream(responseChunks), {
        headers: { 'content-type': 'application/json' },
      }))),
      ACCOUNT_KEY,
      textEstimateDefinition,
    )).rejects.toThrow('Invalid service response');
    expect(cancelReader).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['request', 'request'],
    ['response', 'response'],
  ])('rejects more than 1024 one-byte chunks on the %s side', async (_case, side) => {
    const cancelReader = vi.spyOn(ReadableStreamDefaultReader.prototype, 'cancel');
    const many = Array.from({ length: 1_025 }, () => new Uint8Array([32]));
    const requestChunks = side === 'request'
      ? many
      : [new Uint8Array([123, 125])];
    const responseChunks = side === 'response'
      ? [...many, new TextEncoder().encode('{"ok":true}')]
      : [new TextEncoder().encode('{"ok":true}')];

    await expect(proxyBoundedJson(
      streamingRequest(chunkStream(requestChunks), { 'content-type': 'application/json' }),
      binding(vi.fn(async () => new Response(chunkStream(responseChunks), {
        headers: { 'content-type': 'application/json' },
      }))),
      ACCOUNT_KEY,
      textEstimateDefinition,
    )).rejects.toThrow('Invalid service response');
    expect(cancelReader).toHaveBeenCalledTimes(1);
  });

  test('accepts typical bounded chunking and never cancels successful streams', async () => {
    const cancelReader = vi.spyOn(ReadableStreamDefaultReader.prototype, 'cancel');
    const request = streamingRequest(chunkStream([
      new Uint8Array([97]),
      new Uint8Array([98]),
      new Uint8Array([99]),
    ]), { 'content-type': 'application/json' });
    const downstream = new Response(chunkStream([
      new TextEncoder().encode('{"'),
      new TextEncoder().encode('ok"'),
      new TextEncoder().encode(':true}'),
    ]), { headers: { 'content-type': 'application/json' } });

    await expect(proxyBoundedJson(
      request,
      binding(vi.fn(async () => downstream)),
      ACCOUNT_KEY,
      textEstimateDefinition,
    )).resolves.toEqual({ body: { ok: true }, status: 200 });
    expect(cancelReader).not.toHaveBeenCalled();
    expect(request.body?.locked).toBe(false);
    expect(downstream.body?.locked).toBe(false);
  });

  test.each([
    'multipart/form-data; boundary=a',
    'Multipart/Form-Data; Boundary=a',
    'MULTIPART/FORM-DATA; BOUNDARY="safe-boundary"',
    'multipart/form-data;    Boundary="safe boundary"',
  ])('preserves a validated multipart boundary while rebuilding body headers: %s', async (contentType) => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(headerRecord(init?.headers)).toEqual({
        'content-length': '3',
        'content-type': contentType,
        'x-tiezheng-account-key': ACCOUNT_KEY,
      });
      expect(await new Response(init?.body).text()).toBe('abc');
      return json({ ok: true });
    });
    const request = new Request('https://app.example.test/api/nutrition/photo/estimate', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: 'abc',
    });

    await expect(proxyBoundedJson(
      request,
      binding(fetcher),
      ACCOUNT_KEY,
      photoEstimateDefinition,
    )).resolves.toEqual({ body: { ok: true }, status: 200 });
  });

  test.each([
    'multipart/form-data',
    'multipart/form-data; boundary=',
    'multipart/form-data; boundary=a; boundary=b',
    'multipart/form-data; boundary="a"; charset=utf-8',
    `multipart/form-data; boundary=${'a'.repeat(71)}`,
  ])('rejects an invalid or duplicate multipart boundary: %s', async (contentType) => {
    const fetcher = vi.fn();
    const request = new Request('https://app.example.test/api/nutrition/photo/estimate', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: 'abc',
    });

    await expect(proxyBoundedJson(
      request,
      binding(fetcher),
      ACCOUNT_KEY,
      photoEstimateDefinition,
    )).rejects.toThrow('Invalid service response');
    expect(fetcher).not.toHaveBeenCalled();
  });

  test.each([
    ['photo receives JSON', photoEstimateDefinition, 'application/json'],
    ['text receives multipart', textEstimateDefinition, 'multipart/form-data; boundary=a'],
  ])('rejects protocol confusion when %s', async (_case, definition, contentType) => {
    const fetcher = vi.fn();
    const request = new Request('https://app.example.test/api/nutrition/estimate', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: 'x',
    });

    await expect(proxyBoundedJson(
      request,
      binding(fetcher),
      ACCOUNT_KEY,
      definition,
    )).rejects.toThrow('Invalid service response');
    expect(fetcher).not.toHaveBeenCalled();
  });

  test.each([
    ['missing body', null],
    ['empty body', ''],
  ])('rejects a %s before calling the service', async (_case, body) => {
    const fetcher = vi.fn();
    const request = new Request('https://app.example.test/api/nutrition/text/estimate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

    await expect(proxyBoundedJson(
      request,
      binding(fetcher),
      ACCOUNT_KEY,
      textEstimateDefinition,
    )).rejects.toThrow('Invalid service response');
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('uses Content-Length only for an early oversized rejection', async () => {
    const cancel = vi.fn();
    const fetcher = vi.fn();
    const request = streamingRequest(
      pendingStream([new TextEncoder().encode('{}')], cancel),
      {
        'content-length': '8193',
        'content-type': 'application/json',
      },
    );

    await expect(proxyBoundedJson(
      request,
      binding(fetcher),
      ACCOUNT_KEY,
      textEstimateDefinition,
    )).rejects.toThrow('Invalid service response');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(request.bodyUsed).toBe(true);
    expect(request.body?.locked).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('cancels an unended request body on an invalid media type', async () => {
    const cancel = vi.fn();
    const request = streamingRequest(
      pendingStream([new TextEncoder().encode('{}')], cancel),
      { 'content-type': 'text/plain' },
    );
    const fetcher = vi.fn();

    await expect(proxyBoundedJson(
      request,
      binding(fetcher),
      ACCOUNT_KEY,
      textEstimateDefinition,
    )).rejects.toThrow('Invalid service response');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(request.body?.locked).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('cancels a request stream immediately when actual bytes exceed the limit', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8_193));
      },
      cancel,
    });
    const fetcher = vi.fn();

    await expect(proxyBoundedJson(
      streamingRequest(stream, { 'content-type': 'application/json' }),
      binding(fetcher),
      ACCOUNT_KEY,
      textEstimateDefinition,
    )).rejects.toThrow('Invalid service response');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('fails closed on a request stream error without leaking its detail', async () => {
    const cancelReader = vi.spyOn(ReadableStreamDefaultReader.prototype, 'cancel');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('private request stream detail'));
      },
    });
    const fetcher = vi.fn();
    const operation = proxyBoundedJson(
      streamingRequest(stream, { 'content-type': 'application/json' }),
      binding(fetcher),
      ACCOUNT_KEY,
      textEstimateDefinition,
    );

    await expect(operation).rejects.toThrow('Invalid service response');
    await expect(operation).rejects.not.toThrow('private request stream detail');
    expect(cancelReader).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test.each([
    ['wrong media type', { 'content-type': 'text/plain' }],
    ['declared oversized', {
      'content-length': '256001',
      'content-type': 'application/json',
    }],
  ])('cancels an unended response body on an early %s rejection', async (_case, headers) => {
    const cancel = vi.fn();
    const downstream = new Response(
      pendingStream([new TextEncoder().encode('{"ok":true}')], cancel),
      { headers },
    );

    await expect(proxyBoundedJson(
      new Request('https://app.example.test/api/nutrition/text/session'),
      binding(vi.fn(async () => downstream)),
      ACCOUNT_KEY,
      sessionDefinition,
    )).rejects.toThrow('Invalid service response');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(downstream.body?.locked).toBe(false);
  });

  test.each([
    ['wrong media type', new Response('{}', { headers: { 'content-type': 'text/plain' } })],
    ['declared oversized', json({ ok: true }, 200, { 'content-length': '256001' })],
    ['actual oversized', new Response(new Uint8Array(256_001), { headers: { 'content-type': 'application/json' } })],
    ['missing body', new Response(null, { headers: { 'content-type': 'application/json' } })],
    ['empty body', new Response('', { headers: { 'content-type': 'application/json' } })],
    ['invalid UTF-8', new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } })],
    ['invalid JSON', new Response('{', { headers: { 'content-type': 'application/json' } })],
    ['invalid schema', json({ ok: false })],
    ['status mismatch', json({ ok: true }, 201)],
  ])('normalizes an invalid downstream %s response', async (_case, downstream) => {
    const fetcher = vi.fn(async () => downstream);

    await expect(proxyBoundedJson(
      new Request('https://app.example.test/api/nutrition/text/session'),
      binding(fetcher),
      ACCOUNT_KEY,
      sessionDefinition,
    )).rejects.toThrow('Invalid service response');
  });

  test('cancels an oversized downstream response stream', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(256_001));
      },
      cancel,
    });
    const fetcher = vi.fn(async () => new Response(stream, {
      headers: { 'content-type': 'application/json' },
    }));

    await expect(proxyBoundedJson(
      new Request('https://app.example.test/api/nutrition/text/session'),
      binding(fetcher),
      ACCOUNT_KEY,
      sessionDefinition,
    )).rejects.toThrow('Invalid service response');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });

  test('fails closed on a downstream stream or fetch error without leaking detail', async () => {
    const cancelReader = vi.spyOn(ReadableStreamDefaultReader.prototype, 'cancel');
    const responseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('private downstream stream detail'));
      },
    });
    const streamFetcher = vi.fn(async () => new Response(responseStream, {
      headers: { 'content-type': 'application/json' },
    }));
    const streamOperation = proxyBoundedJson(
      new Request('https://app.example.test/api/nutrition/text/session'),
      binding(streamFetcher),
      ACCOUNT_KEY,
      sessionDefinition,
    );

    await expect(streamOperation).rejects.toThrow('Invalid service response');
    await expect(streamOperation).rejects.not.toThrow('private downstream stream detail');
    expect(cancelReader).toHaveBeenCalledTimes(1);
    expect(responseStream.locked).toBe(false);

    const fetchOperation = proxyBoundedJson(
      new Request('https://app.example.test/api/nutrition/text/session'),
      binding(vi.fn(async () => {
        throw new Error('private binding detail');
      })),
      ACCOUNT_KEY,
      sessionDefinition,
    );
    await expect(fetchOperation).rejects.toThrow('Invalid service response');
    await expect(fetchOperation).rejects.not.toThrow('private binding detail');
  });

  test.each([
    ['throws', () => {
      throw new Error('private cancel throw');
    }],
    ['rejects', () => Promise.reject(new Error('private cancel rejection'))],
    ['never settles', () => new Promise<void>(() => undefined)],
  ])('keeps the fixed failure and releases the lock when cancellation %s', async (_case, cancel) => {
    const cancelReader = vi.spyOn(ReadableStreamDefaultReader.prototype, 'cancel')
      .mockImplementation(cancel);
    const stream = pendingStream([new DataView(new ArrayBuffer(1))]);
    const request = streamingRequest(stream, { 'content-type': 'application/json' });
    const operation = proxyBoundedJson(
      request,
      binding(vi.fn()),
      ACCOUNT_KEY,
      textEstimateDefinition,
    );

    const result = await Promise.race([
      operation.then(
        () => 'resolved',
        (error: unknown) => error,
      ),
      new Promise<'timed-out'>((resolve) => {
        setTimeout(() => resolve('timed-out'), 50);
      }),
    ]);

    expect(result).toBeInstanceOf(TypeError);
    expect((result as Error).message).toBe('Invalid service response');
    expect(cancelReader).toHaveBeenCalledTimes(1);
    expect(request.body?.locked).toBe(false);
  });

  test.each(['', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)])(
    'rejects an invalid account key before any network call: %s',
    async (accountKey) => {
      const fetcher = vi.fn();
      await expect(proxyBoundedJson(
        new Request('https://app.example.test/api/nutrition/text/session'),
        binding(fetcher),
        accountKey,
        sessionDefinition,
      )).rejects.toThrow('Invalid service response');
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});
