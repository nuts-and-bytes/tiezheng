import { describe, expect, expectTypeOf, test, vi } from 'vitest';

import { PHOTO_AI_VERSIONS, type PhotoAiRequestMetadata } from '../../../src/lib/photoAiContract';
import type { GatewayEnv } from './env';
import { readPhotoUpload, sanitizeImage } from './imageFirewall';

const REQUEST_FIELDS = [
  'requestId',
  'idempotencyKey',
  'uploadBlobSha256',
  'modelVersion',
  'promptVersion',
  'schemaVersion',
  'catalogVersion',
  'transformVersion',
  'uncertaintyVersion',
  'providerPolicyVersion',
  'locale',
] as const;
const MULTIPART_MAX_BYTES = 1_100_000;

function jpeg(width = 2, height = 3): Uint8Array {
  return Uint8Array.of(
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
    height >> 8, height & 0xff, width >> 8, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  );
}

function webp(width = 2, height = 3): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0, 0]);
  const encodedWidth = width - 1;
  const encodedHeight = height - 1;
  bytes[24] = encodedWidth & 0xff;
  bytes[25] = (encodedWidth >> 8) & 0xff;
  bytes[26] = (encodedWidth >> 16) & 0xff;
  bytes[27] = encodedHeight & 0xff;
  bytes[28] = (encodedHeight >> 8) & 0xff;
  bytes[29] = (encodedHeight >> 16) & 0xff;
  return bytes;
}

function metadata(sha: string): PhotoAiRequestMetadata {
  return {
    requestId: 'request-123',
    idempotencyKey: 'b'.repeat(32),
    uploadBlobSha256: sha,
    modelVersion: PHOTO_AI_VERSIONS.model,
    promptVersion: PHOTO_AI_VERSIONS.prompt,
    schemaVersion: PHOTO_AI_VERSIONS.schema,
    catalogVersion: PHOTO_AI_VERSIONS.catalog,
    transformVersion: PHOTO_AI_VERSIONS.transform,
    uncertaintyVersion: PHOTO_AI_VERSIONS.uncertainty,
    providerPolicyVersion: PHOTO_AI_VERSIONS.providerPolicy,
    locale: 'zh-CN',
  };
}

async function hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

type MultipartPart = {
  name: string;
  value: string | Uint8Array;
  filename?: string;
  contentType?: string;
};

function multipartRequest(
  parts: readonly MultipartPart[],
  boundary = '----formdata-undici-123456789012',
  quotedBoundary = false,
): Request {
  const text = new TextEncoder();
  const fields: Uint8Array[] = [];
  for (const part of parts) {
    const disposition = `Content-Disposition: form-data; name="${part.name}"${part.filename === undefined ? '' : `; filename="${part.filename}"`}`;
    const type = part.contentType === undefined ? '' : `\r\nContent-Type: ${part.contentType}`;
    fields.push(text.encode(`--${boundary}\r\n${disposition}${type}\r\n\r\n`));
    fields.push(typeof part.value === 'string' ? text.encode(part.value) : part.value);
    fields.push(text.encode('\r\n'));
  }
  fields.push(text.encode(`--${boundary}--\r\n`));
  const length = fields.reduce((total, field) => total + field.length, 0);
  const body = new Uint8Array(length);
  let offset = 0;
  for (const field of fields) { body.set(field, offset); offset += field.length; }
  const contentType = quotedBoundary
    ? `multipart/form-data; boundary="${boundary}"`
    : `multipart/form-data; boundary=${boundary}`;
  return new Request('https://example.test/estimate', { method: 'POST', headers: { 'content-type': contentType }, body });
}

async function clientParts(bytes = jpeg()): Promise<MultipartPart[]> {
  const value = metadata(await hash(bytes));
  return [
    { name: 'image', value: bytes, filename: 'food.webp', contentType: 'image/jpeg' },
    ...REQUEST_FIELDS.map((name) => ({ name, value: value[name] })),
  ];
}

async function uploadRequest(bytes = jpeg(), imageType = 'image/jpeg'): Promise<Request> {
  const parts = await clientParts(bytes);
  parts[0].contentType = imageType;
  return multipartRequest(parts);
}

function png(width = 2, height = 3, animated = false): Uint8Array {
  const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
  const chunk = (type: string, data: Uint8Array) => {
    const bytes = new Uint8Array(data.length + 12);
    bytes.set([0, 0, 0, data.length], 0);
    bytes.set(new TextEncoder().encode(type), 4);
    bytes.set(data, 8);
    return bytes;
  };
  const ihdr = new Uint8Array(13);
  ihdr.set([width >>> 24, width >>> 16, width >>> 8, width, height >>> 24, height >>> 16, height >>> 8, height]);
  const chunks = [signature, chunk('IHDR', ihdr)];
  if (animated) chunks.push(chunk('acTL', Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 0)));
  chunks.push(chunk('IEND', new Uint8Array()));
  const result = new Uint8Array(chunks.reduce((total, value) => total + value.length, 0));
  let offset = 0;
  for (const value of chunks) { result.set(value, offset); offset += value.length; }
  return result;
}

function jpegWithApp2(payload: Uint8Array): Uint8Array {
  const length = payload.length + 2;
  const app2 = new Uint8Array(payload.length + 4);
  app2.set([0xff, 0xe2, length >> 8, length & 0xff]);
  app2.set(payload, 4);
  const source = jpeg();
  const result = new Uint8Array(source.length + app2.length);
  result.set(source.subarray(0, 2));
  result.set(app2, 2);
  result.set(source.subarray(2), 2 + app2.length);
  return result;
}

function jpegWithMpf(): Uint8Array {
  return jpegWithApp2(Uint8Array.of(0x4d, 0x50, 0x46, 0x00));
}

function jpegOfSize(size: number): Uint8Array {
  const chunks: Uint8Array[] = [jpeg().subarray(0, -2)];
  let length = chunks[0].length;
  while (length + 6 <= size) {
    const dataLength = Math.min(65_533, size - length - 6);
    const chunk = new Uint8Array(dataLength + 4);
    chunk.set([0xff, 0xfe, (dataLength + 2) >> 8, (dataLength + 2) & 0xff]);
    chunks.push(chunk);
    length += chunk.length;
  }
  chunks.push(Uint8Array.of(0xff, 0xd9));
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

class TrackingChunk extends Uint8Array<ArrayBuffer> {
  readonly sliceCalls: Array<readonly [number | undefined, number | undefined]> = [];

  override slice(start?: number, end?: number): Uint8Array<ArrayBuffer> {
    this.sliceCalls.push([start, end]);
    return super.slice(start, end);
  }
}

function stream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
}

describe('photo AI image firewall', () => {
  test('declares only the edge gateway bindings and string configuration', () => {
    expectTypeOf<GatewayEnv>().toMatchTypeOf<{
      IMAGES: ImagesBinding;
      PHOTO_AI_COORDINATOR: DurableObjectNamespace<import('./coordinator').PhotoAiCoordinator>;
      PHOTO_AI_GATEWAY_ENABLED: string;
      PHOTO_AI_MODEL: string;
      PHOTO_AI_ALLOWED_ORIGINS: string;
      PHOTO_AI_MONTHLY_BUDGET_MICROS: string;
      ARK_API_KEY: string;
      PHOTO_AI_CACHE_AES_KEY: string;
    }>();
  });

  test('reads the exact image plus eleven fields sent by the real client multipart body', async () => {
    const bytes = webp(640, 480);
    const upload = await readPhotoUpload(await uploadRequest(bytes, 'image/webp'));
    expect(upload).toMatchObject({ mime: 'image/webp', width: 640, height: 480, metadata: metadata(await hash(bytes)) });
    expect(upload.bytes).toEqual(bytes);
  });

  test('accepts a quoted real-FormData boundary', async () => {
    const bytes = webp(40, 20);
    const parts = await clientParts(bytes);
    parts[0].contentType = 'image/webp';
    await expect(readPhotoUpload(multipartRequest(parts, '----WebKitFormBoundary7MA4YWxkTrZu0gW', true))).resolves.toMatchObject({ mime: 'image/webp' });
  });

  test('ignores boundary-like bytes in an otherwise valid image part', async () => {
    const boundary = 'photo-ai-collision-boundary';
    const marker = new TextEncoder().encode(`ICC_PROFILE\0\r\n--${boundary}X`);
    const bytes = jpegWithApp2(marker);
    const parts = await clientParts(bytes);
    const expectedMetadata = metadata(await hash(bytes));

    await expect(readPhotoUpload(multipartRequest(parts, boundary))).resolves.toMatchObject({
      mime: 'image/jpeg',
      metadata: expectedMetadata,
    });
  });

  test('rejects legacy metadata JSON instead of the exact client text-field contract', async () => {
    const bytes = jpeg();
    await expect(readPhotoUpload(multipartRequest([
      { name: 'image', value: bytes, filename: 'food.webp', contentType: 'image/jpeg' },
      { name: 'metadata', value: JSON.stringify(metadata(await hash(bytes))) },
    ]))).rejects.toThrow('invalid photo upload');
  });

  test('rejects unsupported, truncated, animated, and absurd image containers', async () => {
    await expect(readPhotoUpload(await uploadRequest(Uint8Array.of(0x47, 0x49, 0x46, 0x38)))).rejects.toThrow('invalid photo upload');
    await expect(readPhotoUpload(await uploadRequest(jpeg().subarray(0, 8)))).rejects.toThrow('invalid photo upload');
    const animation = webp(); animation.set([0x41, 0x4e, 0x49, 0x4d], 12);
    await expect(readPhotoUpload(await uploadRequest(animation))).rejects.toThrow('invalid photo upload');
    await expect(readPhotoUpload(await uploadRequest(jpeg(12001, 1)))).rejects.toThrow('invalid photo upload');
  });

  test('fails closed for a forged content length and stream errors', async () => {
    const request = await uploadRequest();
    const headers = new Headers();
    request.headers.forEach((value, key) => headers.set(key, value));
    headers.set('content-length', '1100001');
    const oversized = new Request(request, { headers });
    await expect(readPhotoUpload(oversized)).rejects.toThrow('invalid photo upload');
    const broken = { method: 'POST', headers: new Headers({ 'content-type': 'multipart/form-data; boundary=x' }), body: new ReadableStream({ start(controller) { controller.error(new Error('socket')); } }) } as unknown as Request;
    await expect(readPhotoUpload(broken)).rejects.toThrow('invalid photo upload');
  });

  test('does not accept a mismatched uploaded hash', async () => {
    const parts = await clientParts();
    parts.find((part) => part.name === 'uploadBlobSha256')!.value = 'a'.repeat(64);
    await expect(readPhotoUpload(multipartRequest(parts))).rejects.toThrow('invalid photo upload');
  });

  test('rejects a required text field disguised as a file part', async () => {
    const parts = await clientParts();
    parts.find((part) => part.name === 'locale')!.filename = 'locale.txt';
    await expect(readPhotoUpload(multipartRequest(parts))).rejects.toThrow('invalid photo upload');
  });

  test.each([
    ['SVG', new TextEncoder().encode('<svg/>'), 'image/svg+xml'],
    ['PDF', Uint8Array.of(0x25, 0x50, 0x44, 0x46), 'application/pdf'],
    ['HEIC', Uint8Array.of(0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63), 'image/heic'],
  ])('rejects %s containers', async (_label, bytes, imageType) => {
    await expect(readPhotoUpload(await uploadRequest(bytes, imageType))).rejects.toThrow('invalid photo upload');
  });

  test('accepts bounded PNG and WebP client uploads', async () => {
    await expect(readPhotoUpload(await uploadRequest(png(40, 20), 'image/png'))).resolves.toMatchObject({ mime: 'image/png', width: 40, height: 20 });
    await expect(readPhotoUpload(await uploadRequest(webp(40, 20), 'image/webp'))).resolves.toMatchObject({ mime: 'image/webp', width: 40, height: 20 });
  });

  test.each([
    ['APNG', png(2, 3, true), 'image/png'],
    ['JPEG MPO', jpegWithMpf(), 'image/jpeg'],
    ['too many pixels', jpeg(8000, 6000), 'image/jpeg'],
    ['excessive aspect ratio', jpeg(21, 1), 'image/jpeg'],
    ['zero dimension', jpeg(0, 1), 'image/jpeg'],
  ])('rejects %s image content', async (_label, bytes, imageType) => {
    await expect(readPhotoUpload(await uploadRequest(bytes, imageType))).rejects.toThrow('invalid photo upload');
  });

  test('allows ICC APP2 data but rejects an MPF APP2 marker', async () => {
    const icc = jpegWithApp2(new TextEncoder().encode('ICC_PROFILE\0'));
    await expect(readPhotoUpload(await uploadRequest(icc))).resolves.toMatchObject({ mime: 'image/jpeg' });
    await expect(readPhotoUpload(await uploadRequest(jpegWithMpf()))).rejects.toThrow('invalid photo upload');
  });

  test.each([
    ['a missing field', async () => (await clientParts()).filter((part) => part.name !== 'locale')],
    ['a duplicate field', async () => [...await clientParts(), { name: 'locale', value: 'zh-CN' }]],
    ['an extra field', async () => [...await clientParts(), { name: '__proto__', value: 'pollute' }]],
    ['CRLF in text', async () => { const parts = await clientParts(); parts.find((part) => part.name === 'requestId')!.value = 'request\r\nnext'; return parts; }],
    ['non-UTF-8 text', async () => { const parts = await clientParts(); parts.find((part) => part.name === 'locale')!.value = Uint8Array.of(0xff); return parts; }],
    ['an overlong text value', async () => { const parts = await clientParts(); parts.find((part) => part.name === 'modelVersion')!.value = 'm'.repeat(513); return parts; }],
  ])('rejects %s in client metadata fields', async (_label, makeParts) => {
    await expect(readPhotoUpload(multipartRequest(await makeParts()))).rejects.toThrow('invalid photo upload');
  });

  test('rejects an actual multipart stream above 1.1MB', async () => {
    const bytes = new Uint8Array(1_100_001);
    await expect(readPhotoUpload(await uploadRequest(bytes))).rejects.toThrow('invalid photo upload');
  });

  test('bounds an oversized first stream chunk to remaining plus one and cancels its producer', async () => {
    const chunk = new TrackingChunk(new ArrayBuffer(MULTIPART_MAX_BYTES + 64));
    let pulls = 0;
    let cancels = 0;
    const request = {
      method: 'POST',
      headers: new Headers({ 'content-type': 'multipart/form-data; boundary=x' }),
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          controller.enqueue(chunk);
        },
        cancel() {
          cancels += 1;
        },
      }),
    } as unknown as Request;
    await expect(readPhotoUpload(request)).rejects.toThrow('invalid photo upload');
    expect(chunk.sliceCalls).toEqual([[0, MULTIPART_MAX_BYTES + 1]]);
    expect(cancels).toBe(1);
    expect(pulls).toBe(1);
  });

  test('keeps the public failure generic when cancelling an oversized stream fails', async () => {
    const request = {
      method: 'POST',
      headers: new Headers({ 'content-type': 'multipart/form-data; boundary=x' }),
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(MULTIPART_MAX_BYTES + 1));
        },
        cancel() {
          throw new Error('producer cancel failed');
        },
      }),
    } as unknown as Request;
    await expect(readPhotoUpload(request)).rejects.toThrow('invalid photo upload');
  });

  test('rejects an image part above 1MB even when the multipart body is below 1.1MB', async () => {
    const bytes = jpegOfSize(1_000_001);
    await expect(readPhotoUpload(await uploadRequest(bytes))).rejects.toThrow('invalid photo upload');
  });

  test('uses distinct image streams and emits a bounded static WebP at the scaled dimensions', async () => {
    const upload = await readPhotoUpload(await uploadRequest(jpeg(3200, 1600)));
    const output = webp(1600, 800);
    const info = vi.fn(async (_value: ReadableStream<Uint8Array>) => ({ format: 'image/jpeg', fileSize: upload.bytes.byteLength, width: 3200, height: 1600 }));
    const transform = vi.fn();
    let inputStream: ReadableStream<Uint8Array> | undefined;
    const binding = {
      info,
      input: (value: ReadableStream<Uint8Array>) => { inputStream = value; return { transform: (options: unknown) => { transform(options); return { output: async (outputOptions: unknown) => { transform(outputOptions); return { response: () => new Response(stream(output)) }; } }; } }; },
      CACHE: { put: vi.fn() },
      R2: { put: vi.fn() },
      KV: { put: vi.fn() },
    } as unknown as ImagesBinding;
    const sanitized = await sanitizeImage(upload, binding);
    expect(info.mock.calls[0][0]).not.toBe(inputStream);
    expect(transform).toHaveBeenNthCalledWith(1, { width: 1600, height: 800, fit: 'scale-down' });
    expect(transform).toHaveBeenNthCalledWith(2, { format: 'image/webp', quality: 80, anim: false });
    expect((binding as unknown as { CACHE: { put: ReturnType<typeof vi.fn> } }).CACHE.put).not.toHaveBeenCalled();
    expect((binding as unknown as { R2: { put: ReturnType<typeof vi.fn> } }).R2.put).not.toHaveBeenCalled();
    expect((binding as unknown as { KV: { put: ReturnType<typeof vi.fn> } }).KV.put).not.toHaveBeenCalled();
    expect(sanitized).toMatchObject({ mime: 'image/webp', width: 1600, height: 800, sha256: await hash(output) });
    expect(sanitized.bytes).toEqual(output);
  });

  test('rejects non-WebP transformed output', async () => {
    const upload = await readPhotoUpload(await uploadRequest());
    const binding = {
      info: async () => ({ format: 'image/jpeg', fileSize: upload.bytes.byteLength, width: upload.width, height: upload.height }),
      input: () => ({ transform: () => ({ output: async () => ({ response: () => new Response(stream(jpeg())) }) }) }),
    } as unknown as ImagesBinding;
    await expect(sanitizeImage(upload, binding)).rejects.toThrow('invalid photo upload');
  });

  test('rejects transformed output above the byte cap', async () => {
    const upload = await readPhotoUpload(await uploadRequest());
    const binding = {
      info: async () => ({ format: 'image/jpeg', fileSize: upload.bytes.byteLength, width: upload.width, height: upload.height }),
      input: () => ({ transform: () => ({ output: async () => ({ response: () => new Response(stream(new Uint8Array(1_000_001))) }) }) }),
    } as unknown as ImagesBinding;
    await expect(sanitizeImage(upload, binding)).rejects.toThrow('invalid photo upload');
  });

  test('rejects Images metadata that disagrees with the cheap container parser', async () => {
    const upload = await readPhotoUpload(await uploadRequest());
    const binding = {
      info: async () => ({ format: 'image/jpeg', fileSize: upload.bytes.byteLength, width: 99, height: upload.height }),
      input: () => { throw new Error('must not transform'); },
    } as unknown as ImagesBinding;
    await expect(sanitizeImage(upload, binding)).rejects.toThrow('invalid photo upload');
  });

  test('rejects Images file-size metadata that disagrees with the bounded upload', async () => {
    const upload = await readPhotoUpload(await uploadRequest());
    const input = vi.fn(() => { throw new Error('must not transform'); });
    const binding = {
      info: async () => ({
        format: 'image/jpeg',
        fileSize: upload.bytes.byteLength - 1,
        width: upload.width,
        height: upload.height,
      }),
      input,
    } as unknown as ImagesBinding;

    await expect(sanitizeImage(upload, binding)).rejects.toThrow('invalid photo upload');
    expect(input).not.toHaveBeenCalled();
  });

  test('uses one immutable upload snapshot across asynchronous Images calls', async () => {
    const upload = await readPhotoUpload(await uploadRequest());
    const original = upload.bytes.slice();
    let releaseInfo!: () => void;
    const infoGate = new Promise<void>((resolve) => { releaseInfo = resolve; });
    let transformedInput: Uint8Array | undefined;
    const output = webp(upload.width, upload.height);
    const binding = {
      info: async () => {
        await infoGate;
        return {
          format: 'image/jpeg',
          fileSize: original.byteLength,
          width: upload.width,
          height: upload.height,
        };
      },
      input: (value: ReadableStream<Uint8Array>) => ({
        transform: () => ({
          output: async () => {
            const reader = value.getReader();
            transformedInput = (await reader.read()).value;
            return { response: () => new Response(stream(output)) };
          },
        }),
      }),
    } as unknown as ImagesBinding;

    const pending = sanitizeImage(upload, binding);
    upload.bytes.fill(0);
    releaseInfo();

    await expect(pending).resolves.toMatchObject({ mime: 'image/webp' });
    expect(transformedInput).toEqual(original);
  });
});
