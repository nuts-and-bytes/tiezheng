import { describe, expect, test } from 'vitest';

import {
  ProviderResponseError,
  parseResponsesOutput,
  readBoundedProviderText,
} from './doubaoResponse';

const MAX_PROVIDER_BYTES = 256_000;

function providerEnvelope(
  text = '{"status":"uncertain","candidate":null}',
  usage: unknown = { input_tokens: 100, output_tokens: 20 },
): Record<string, unknown> {
  return {
    id: 'resp-test',
    object: 'response',
    status: 'completed',
    output: [{
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text }],
    }],
    usage,
  };
}

function officialUsage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    input_tokens: 100,
    input_tokens_details: { cached_tokens: 25 },
    output_tokens: 20,
    output_tokens_details: { reasoning_tokens: 5 },
    total_tokens: 120,
    ...overrides,
  };
}

function jsonResponse(body: BodyInit, status = 200, contentType = 'application/json; charset=utf-8'): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': contentType },
  });
}

describe('parseResponsesOutput', () => {
  test('extracts exactly one completed output_text and snapshots exact usage', () => {
    const envelope = providerEnvelope('model-json');
    expect(parseResponsesOutput(envelope)).toEqual({
      text: 'model-json',
      usage: { inputTokens: 100, outputTokens: 20 },
    });

    const withoutMessageStatus = providerEnvelope('model-json');
    delete ((withoutMessageStatus.output as Array<Record<string, unknown>>)[0]).status;
    expect(parseResponsesOutput(withoutMessageStatus)).toEqual({
      text: 'model-json',
      usage: { inputTokens: 100, outputTokens: 20 },
    });
  });

  test('accepts the exact official Ark ResponseUsage while returning the stable two-field ABI', () => {
    expect(parseResponsesOutput(providerEnvelope('model-json', officialUsage()))).toEqual({
      text: 'model-json',
      usage: { inputTokens: 100, outputTokens: 20 },
    });
  });

  test.each([
    ['missing usage', undefined],
    ['null usage', null],
  ])('keeps the existing nullable photo usage contract for %s', (_label, usage) => {
    const envelope = providerEnvelope('model-json', usage);
    if (usage === undefined) delete envelope.usage;
    expect(parseResponsesOutput(envelope)).toEqual({ text: 'model-json', usage: null });
  });

  test.each([
    ['non-completed root', { ...providerEnvelope(), status: 'incomplete' }],
    ['missing output', { status: 'completed' }],
    ['empty output', { ...providerEnvelope(), output: [] }],
    ['two messages', { ...providerEnvelope(), output: [
      (providerEnvelope().output as unknown[])[0],
      (providerEnvelope().output as unknown[])[0],
    ] }],
    ['function call container', { ...providerEnvelope(), output: [{ type: 'function_call', name: 'steal' }] }],
    ['non-completed message', { ...providerEnvelope(), output: [{
      type: 'message', status: 'incomplete', content: [{ type: 'output_text', text: 'x' }],
    }] }],
    ['two content items', { ...providerEnvelope(), output: [{
      type: 'message', status: 'completed', content: [
        { type: 'output_text', text: 'x' },
        { type: 'output_text', text: 'y' },
      ],
    }] }],
    ['refusal content', { ...providerEnvelope(), output: [{
      type: 'message', status: 'completed', content: [{ type: 'refusal', refusal: 'no' }],
    }] }],
    ['empty text', providerEnvelope('')],
    ['oversized text', providerEnvelope('x'.repeat(100_001))],
    ['non-string text', providerEnvelope(123 as unknown as string)],
    ['sparse output', { ...providerEnvelope(), output: new Array(1) }],
    ['decorated output', { ...providerEnvelope(), output: Object.assign([
      (providerEnvelope().output as unknown[])[0],
    ], { leaked: true }) }],
  ])('rejects ambiguous or unusable envelope: %s', (_label, envelope) => {
    expect(() => parseResponsesOutput(envelope)).toThrow('Invalid provider response');
  });

  test.each([
    ['negative input', { input_tokens: -1, output_tokens: 1 }],
    ['negative zero input', { input_tokens: -0, output_tokens: 1 }],
    ['negative zero output', { input_tokens: 1, output_tokens: -0 }],
    ['fractional token', { input_tokens: 1.5, output_tokens: 1 }],
    ['unsafe token', { input_tokens: Number.MAX_SAFE_INTEGER + 1, output_tokens: 1 }],
    ['extra usage key', { input_tokens: 1, output_tokens: 1, total_tokens: 2 }],
    ['missing usage key', { input_tokens: 1 }],
    ['exotic usage object', Object.assign(Object.create({}), { input_tokens: 1, output_tokens: 1 })],
    ['official extra root key', officialUsage({ charged_tokens: 120 })],
    ['official missing details', (() => {
      const usage = officialUsage();
      delete usage.input_tokens_details;
      return usage;
    })()],
    ['official total mismatch', officialUsage({ total_tokens: 119 })],
    ['official total overflow', officialUsage({
      input_tokens: Number.MAX_SAFE_INTEGER,
      output_tokens: 1,
      total_tokens: Number.MAX_SAFE_INTEGER,
    })],
    ['negative cached tokens', officialUsage({ input_tokens_details: { cached_tokens: -1 } })],
    ['negative-zero cached tokens', officialUsage({ input_tokens_details: { cached_tokens: -0 } })],
    ['unsafe cached tokens', officialUsage({ input_tokens_details: { cached_tokens: Number.MAX_SAFE_INTEGER + 1 } })],
    ['cached tokens exceed input', officialUsage({ input_tokens_details: { cached_tokens: 101 } })],
    ['input details extra key', officialUsage({ input_tokens_details: { cached_tokens: 25, leaked: 1 } })],
    ['negative reasoning tokens', officialUsage({ output_tokens_details: { reasoning_tokens: -1 } })],
    ['negative-zero reasoning tokens', officialUsage({ output_tokens_details: { reasoning_tokens: -0 } })],
    ['unsafe reasoning tokens', officialUsage({ output_tokens_details: { reasoning_tokens: Number.MAX_SAFE_INTEGER + 1 } })],
    ['reasoning tokens exceed output', officialUsage({ output_tokens_details: { reasoning_tokens: 21 } })],
    ['output details extra key', officialUsage({ output_tokens_details: { reasoning_tokens: 5, leaked: 1 } })],
  ])('rejects invalid usage: %s', (_label, usage) => {
    expect(() => parseResponsesOutput(providerEnvelope('model-json', usage)))
      .toThrow('Invalid provider response');
  });

  test('rejects usage accessors without invoking them', () => {
    let invoked = false;
    const usage = Object.defineProperties({}, {
      input_tokens: {
        enumerable: true,
        get() {
          invoked = true;
          return 1;
        },
      },
      output_tokens: { enumerable: true, value: 1 },
    });
    expect(() => parseResponsesOutput(providerEnvelope('model-json', usage)))
      .toThrow('Invalid provider response');
    expect(invoked).toBe(false);
  });

  test('rejects official detail accessors without invoking them', () => {
    let invoked = false;
    const inputDetails = Object.defineProperty({}, 'cached_tokens', {
      enumerable: true,
      get() {
        invoked = true;
        return 25;
      },
    });
    expect(() => parseResponsesOutput(providerEnvelope('model-json', officialUsage({
      input_tokens_details: inputDetails,
    })))).toThrow('Invalid provider response');
    expect(invoked).toBe(false);
  });
});

describe('readBoundedProviderText', () => {
  test('reads an exact-boundary JSON response with fatal UTF-8 and releases the lock', async () => {
    const body = 'x'.repeat(MAX_PROVIDER_BYTES);
    const response = jsonResponse(body);
    await expect(readBoundedProviderText(response, MAX_PROVIDER_BYTES)).resolves.toBe(body);
    expect(response.body?.locked).toBe(false);
  });

  test('accepts cross-realm-compatible Uint8Array chunks by intrinsic brand', async () => {
    const branded = new Uint8Array(new TextEncoder().encode('{"ok":true}'));
    Object.defineProperty(branded, Symbol.toStringTag, { value: 'spoofed' });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(branded);
        controller.close();
      },
    });
    await expect(readBoundedProviderText(jsonResponse(stream), MAX_PROVIDER_BYTES))
      .resolves.toBe('{"ok":true}');
  });

  test.each([
    ['HTTP error', 503, 'application/json'],
    ['redirect', 302, 'application/json'],
    ['HTML content type', 200, 'text/html'],
    ['JSON-looking text content type', 200, 'text/plain'],
  ])('rejects %s before reading and does not await a hanging cancel', async (_label, status, contentType) => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(0x7b));
      },
      cancel() {
        cancelled = true;
        return new Promise<void>(() => undefined);
      },
    });
    const response = jsonResponse(stream, status, contentType);
    await expect(readBoundedProviderText(response, MAX_PROVIDER_BYTES))
      .rejects.toBeInstanceOf(ProviderResponseError);
    expect(cancelled).toBe(true);
    expect(response.body?.locked).toBe(false);
  });

  test('rejects an absent body and any non-fixed maximum', async () => {
    const noBody = new Response(null, { headers: { 'content-type': 'application/json' } });
    await expect(readBoundedProviderText(noBody, MAX_PROVIDER_BYTES))
      .rejects.toMatchObject({ kind: 'invalid-response', message: 'Invalid provider response' });
    await expect(readBoundedProviderText(jsonResponse('{}'), MAX_PROVIDER_BYTES - 1))
      .rejects.toMatchObject({ kind: 'invalid-response', message: 'Invalid provider response' });
  });

  test.each([
    ['zero-byte chunk', new Uint8Array(0)],
    ['wrong typed-array brand', new Uint16Array([0x7b, 0x7d])],
    ['spoofed Uint8Array object', { 0: 0x7b, byteLength: 1, [Symbol.toStringTag]: 'Uint8Array' }],
  ])('rejects %s, cancels best-effort and releases the reader', async (_label, chunk) => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk as Uint8Array);
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = jsonResponse(stream);
    await expect(readBoundedProviderText(response, MAX_PROVIDER_BYTES))
      .rejects.toMatchObject({ kind: 'invalid-response', message: 'Invalid provider response' });
    expect(cancelled).toBe(true);
    expect(response.body?.locked).toBe(false);
  });

  test('rejects total overflow before copy and cancels the reader', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(200_000));
        controller.enqueue(new Uint8Array(56_001));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = jsonResponse(stream);
    await expect(readBoundedProviderText(response, MAX_PROVIDER_BYTES))
      .rejects.toMatchObject({ kind: 'invalid-response', message: 'Invalid provider response' });
    expect(cancelled).toBe(true);
    expect(response.body?.locked).toBe(false);
  });

  test('hides stream errors and maps them separately from malformed content', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('provider-secret-stream-detail'));
      },
    });
    const response = jsonResponse(stream);
    const promise = readBoundedProviderText(response, MAX_PROVIDER_BYTES);
    await expect(promise).rejects.toMatchObject({
      kind: 'read-failed',
      message: 'Provider response read failed',
    });
    await expect(promise).rejects.not.toThrow('provider-secret-stream-detail');
    expect(response.body?.locked).toBe(false);
  });

  test('uses fatal UTF-8 decoding and hides invalid bytes', async () => {
    const response = jsonResponse(Uint8Array.of(0xff));
    await expect(readBoundedProviderText(response, MAX_PROVIDER_BYTES))
      .rejects.toMatchObject({ kind: 'invalid-response', message: 'Invalid provider response' });
    expect(response.body?.locked).toBe(false);
  });
});
