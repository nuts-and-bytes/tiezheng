import { PHOTO_AI_LIMITS } from './photoAiContract';
import {
  PhotoPreparationError,
  preparePhoto,
  type DecodedPhoto,
  type EncodedPhoto,
  type EncodePhotoRequest,
  type PhotoCodec,
  type PreparedPhoto,
} from './photoAiImage';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('公开 seam 在解码前拒绝超过 15 MiB 的受支持图片', async () => {
  let decodeCalls = 0;
  const codec: PhotoCodec = {
    async decode(): Promise<DecodedPhoto> {
      decodeCalls += 1;
      throw new Error('不应解码');
    },
    async encode(
      _source: CanvasImageSource,
      _request: EncodePhotoRequest,
    ): Promise<EncodedPhoto> {
      throw new Error('不应编码');
    },
  };
  const file = new File([new Uint8Array(PHOTO_AI_LIMITS.rawBytes + 1)], 'meal.jpg', {
    type: 'image/jpeg',
  });

  const result: Promise<PreparedPhoto> = preparePhoto(file, codec);

  await expect(result).rejects.toMatchObject({
    code: 'image-too-large',
  });
  expect(decodeCalls).toBe(0);
  expect(PhotoPreparationError).toBeTypeOf('function');
});

function createCodec(width = 4000, height = 3000) {
  const dispose = vi.fn();
  const decoded: DecodedPhoto = {
    source: { width, height } as unknown as CanvasImageSource,
    width,
    height,
    dispose,
  };
  const decode = vi.fn(async (_file: Blob): Promise<DecodedPhoto> => decoded);
  const encode = vi.fn(
    async (
      _source: CanvasImageSource,
      request: EncodePhotoRequest,
    ): Promise<EncodedPhoto> => {
      const scale = Math.min(1, request.longEdge / Math.max(width, height));
      return {
        blob: new Blob([Uint8Array.of(1)], { type: 'image/webp' }),
        width: Math.round(width * scale),
        height: Math.round(height * scale),
      };
    },
  );
  return {
    codec: { decode, encode } satisfies PhotoCodec,
    decode,
    encode,
    dispose,
    decoded,
  };
}

test.each([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])('允许可解码的 %s', async (type) => {
  const harness = createCodec();
  const prepared = await preparePhoto(
    new File([Uint8Array.of(1)], 'meal', { type }),
    harness.codec,
  );

  expect(harness.decode).toHaveBeenCalledOnce();
  expect(prepared.uploadBlob.type).toBe('image/webp');
  prepared.dispose();
});

test('把解码失败收敛为不泄露 cause 与文件名的 decode-failed', async () => {
  const filename = 'private-name.heic';
  const cause = `decoder exploded for ${filename}`;
  const harness = createCodec();
  harness.decode.mockRejectedValueOnce(new Error(cause));

  let caught: unknown;
  try {
    await preparePhoto(
      new File([Uint8Array.of(1)], filename, { type: 'image/heic' }),
      harness.codec,
    );
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(PhotoPreparationError);
  expect(caught).toMatchObject({ code: 'decode-failed' });
  expect((caught as Error).message).not.toContain(filename);
  expect((caught as Error).message).not.toContain(cause);
  expect(harness.encode).not.toHaveBeenCalled();
});

test('拒绝超过 40MP 的解码图并立即释放', async () => {
  const harness = createCodec(8000, 5001);

  await expect(
    preparePhoto(
      new File([Uint8Array.of(1)], 'large.png', { type: 'image/png' }),
      harness.codec,
    ),
  ).rejects.toMatchObject({ code: 'image-too-large' });
  expect(harness.encode).not.toHaveBeenCalled();
  expect(harness.dispose).toHaveBeenCalledOnce();
});

test('默认 codec 优先 createImageBitmap，经 canvas 输出 WebP 并在 dispose 关闭 bitmap', async () => {
  const close = vi.fn();
  const bitmap = { width: 4000, height: 3000, close } as unknown as ImageBitmap;
  const createBitmap = vi.fn(async (_input: Blob) => bitmap);
  vi.stubGlobal('createImageBitmap', createBitmap);
  const createUrl = vi.spyOn(URL, 'createObjectURL');
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL');
  const canvas = installCanvasEncoder();

  const prepared = await preparePhoto(
    new File([Uint8Array.of(1, 2, 3)], 'private.jpg', { type: 'image/jpeg' }),
  );

  expect(createBitmap).toHaveBeenCalledOnce();
  const bitmapInput = createBitmap.mock.calls[0][0];
  expect(bitmapInput).toBeInstanceOf(Blob);
  expect(bitmapInput).not.toBeInstanceOf(File);
  expect(createUrl).not.toHaveBeenCalled();
  expect(revokeUrl).not.toHaveBeenCalled();
  expect(canvas.canvasCalls.map(({ width, height, type, quality }) => ({
    width,
    height,
    type,
    quality,
  }))).toEqual([
    { width: 1600, height: 1200, type: 'image/webp', quality: 0.82 },
    { width: 320, height: 240, type: 'image/webp', quality: 0.82 },
  ]);
  expect(canvas.drawImage).toHaveBeenCalledTimes(2);
  expect(canvas.canvasCalls.every(({ canvas: output }) => output.width === 0 && output.height === 0)).toBe(true);
  expect(close).not.toHaveBeenCalled();
  prepared.dispose();
  prepared.dispose();
  expect(close).toHaveBeenCalledOnce();
});

test.each(['rejects', 'missing'] as const)(
  'createImageBitmap %s 时回退 Image，并精确 revoke object URL',
  async (mode) => {
    if (mode === 'rejects') {
      vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unsupported')));
    } else {
      vi.stubGlobal('createImageBitmap', undefined);
    }
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fallback/1');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL');
    const image = installFallbackImage('load');
    installCanvasEncoder();

    const prepared = await preparePhoto(
      new File([Uint8Array.of(1)], 'meal.heic', { type: 'image/heic' }),
    );

    expect(createUrl).toHaveBeenCalledOnce();
    expect(image.assignedSources).toEqual(['blob:fallback/1']);
    expect(revokeUrl).toHaveBeenCalledOnce();
    expect(revokeUrl).toHaveBeenCalledWith('blob:fallback/1');
    expect(prepared).toMatchObject({
      uploadWidth: 800,
      uploadHeight: 600,
      thumbnailWidth: 320,
      thumbnailHeight: 240,
    });
    prepared.dispose();
    expect(revokeUrl).toHaveBeenCalledOnce();
  },
);

test('Image fallback 成功时 revoke 抛错也必须有界 resolve PreparedPhoto', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unsupported')));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fallback/revoke-load');
  const revokeError = new Error('revoke load internals');
  const revokeUrl = vi
    .spyOn(URL, 'revokeObjectURL')
    .mockImplementation(() => {
      throw revokeError;
    });
  const eventErrors: unknown[] = [];
  installFallbackImage('load', 800, 600, eventErrors);
  installCanvasEncoder();

  const outcome = await settleWithin(
    preparePhoto(new File([Uint8Array.of(1)], 'meal.heic', { type: 'image/heic' })),
  );

  expect(outcome.status).toBe('resolved');
  if (outcome.status !== 'resolved') return;
  expect(outcome.value).toMatchObject({
    uploadWidth: 800,
    uploadHeight: 600,
    thumbnailWidth: 320,
    thumbnailHeight: 240,
  });
  expect(revokeUrl).toHaveBeenCalledOnce();
  expect(eventErrors).toEqual([]);
  outcome.value.dispose();
});

test('Image fallback 失败时 revoke 抛错也必须有界 reject 通用 decode-failed', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unsupported')));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fallback/revoke-error');
  const revokeCause = 'revoke error internals';
  const revokeUrl = vi
    .spyOn(URL, 'revokeObjectURL')
    .mockImplementation(() => {
      throw new Error(revokeCause);
    });
  const eventErrors: unknown[] = [];
  installFallbackImage('error', 800, 600, eventErrors);

  const outcome = await settleWithin(
    preparePhoto(new File([Uint8Array.of(1)], 'meal.heif', { type: 'image/heif' })),
  );

  expect(outcome.status).toBe('rejected');
  if (outcome.status !== 'rejected') return;
  expect(outcome.error).toBeInstanceOf(PhotoPreparationError);
  expect(outcome.error).toMatchObject({ code: 'decode-failed' });
  expect((outcome.error as Error).message).not.toContain(revokeCause);
  expect(revokeUrl).toHaveBeenCalledOnce();
  expect(eventErrors).toEqual([]);
});

test('Image fallback 解码失败也 revoke URL，且不进入 canvas', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unsupported')));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fallback/error');
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL');
  installFallbackImage('error');
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob');

  await expect(
    preparePhoto(new File([Uint8Array.of(1)], 'meal.heif', { type: 'image/heif' })),
  ).rejects.toMatchObject({ code: 'decode-failed' });
  expect(revokeUrl).toHaveBeenCalledOnce();
  expect(revokeUrl).toHaveBeenCalledWith('blob:fallback/error');
  expect(toBlob).not.toHaveBeenCalled();
});

test.each([
  ['null', null],
  ['non-WebP', new Blob([Uint8Array.of(1)], { type: 'image/png' })],
] as const)('默认 canvas 返回 %s 时释放 canvas 与 bitmap 并 fail closed', async (_label, output) => {
  const close = vi.fn();
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
    width: 4000,
    height: 3000,
    close,
  })));
  const canvas = installCanvasEncoder(() => output);

  await expect(
    preparePhoto(new File([Uint8Array.of(1)], 'meal.jpg', { type: 'image/jpeg' })),
  ).rejects.toMatchObject({ code: 'decode-failed' });
  expect(close).toHaveBeenCalledOnce();
  expect(canvas.canvasCalls).toHaveLength(1);
  expect(canvas.canvasCalls[0].canvas).toMatchObject({ width: 0, height: 0 });
});

test('默认路径不调用 fetch、IndexedDB、Cache Storage 或 Web Storage', async () => {
  const close = vi.fn();
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
    width: 800,
    height: 600,
    close,
  })));
  installCanvasEncoder();
  const fetchCall = vi.fn();
  vi.stubGlobal('fetch', fetchCall);
  const indexedDbOpen = vi.spyOn(indexedDB, 'open');
  const cacheOpen = vi.fn();
  const cacheMatch = vi.fn();
  vi.stubGlobal('caches', { open: cacheOpen, match: cacheMatch });
  const storageGet = vi.spyOn(Storage.prototype, 'getItem');
  const storageSet = vi.spyOn(Storage.prototype, 'setItem');
  const storageRemove = vi.spyOn(Storage.prototype, 'removeItem');

  const prepared = await preparePhoto(
    new File([Uint8Array.of(1)], 'meal.png', { type: 'image/png' }),
  );

  expect(fetchCall).not.toHaveBeenCalled();
  expect(indexedDbOpen).not.toHaveBeenCalled();
  expect(cacheOpen).not.toHaveBeenCalled();
  expect(cacheMatch).not.toHaveBeenCalled();
  expect(storageGet).not.toHaveBeenCalled();
  expect(storageSet).not.toHaveBeenCalled();
  expect(storageRemove).not.toHaveBeenCalled();
  prepared.dispose();
});

function encodedFor(
  width: number,
  height: number,
  request: EncodePhotoRequest,
  size = 1,
  type = 'image/webp',
): EncodedPhoto {
  const scale = Math.min(1, request.longEdge / Math.max(width, height));
  return {
    blob: new Blob([new Uint8Array(size)], { type }),
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

function installCanvasEncoder(
  makeBlob: (call: number) => Blob | null = () =>
    new Blob([Uint8Array.of(1)], { type: 'image/webp' }),
) {
  const drawImage = vi.fn();
  const canvasCalls: Array<{
    canvas: HTMLCanvasElement;
    width: number;
    height: number;
    type: string | undefined;
    quality: number | undefined;
  }> = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  const toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string,
      quality?: number,
    ) {
      canvasCalls.push({
        canvas: this,
        width: this.width,
        height: this.height,
        type,
        quality,
      });
      callback(makeBlob(canvasCalls.length));
    });
  return { drawImage, toBlob, canvasCalls };
}

function installFallbackImage(
  outcome: 'load' | 'error',
  width = 800,
  height = 600,
  eventErrors?: unknown[],
) {
  const assignedSources: string[] = [];
  class FakeImage {
    onload: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    naturalWidth = width;
    naturalHeight = height;
    width = width;
    height = height;
    private value = '';

    set src(value: string) {
      this.value = value;
      assignedSources.push(value);
      queueMicrotask(() => {
        const handler = outcome === 'load' ? this.onload : this.onerror;
        try {
          handler?.(new Event(outcome));
        } catch (error) {
          if (eventErrors) eventErrors.push(error);
          else throw error;
        }
      });
    }

    get src() {
      return this.value;
    }
  }
  vi.stubGlobal('Image', FakeImage);
  return { assignedSources };
}

type BoundedOutcome<T> =
  | { status: 'resolved'; value: T }
  | { status: 'rejected'; error: unknown }
  | { status: 'timeout' };

async function settleWithin<T>(
  promise: Promise<T>,
  timeoutMs = 100,
): Promise<BoundedOutcome<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race<BoundedOutcome<T>>([
    promise.then(
      (value) => ({ status: 'resolved', value }),
      (error: unknown) => ({ status: 'rejected', error }),
    ),
    new Promise<BoundedOutcome<T>>((resolve) => {
      timeoutId = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs);
    }),
  ]);
  if (timeoutId !== undefined) clearTimeout(timeoutId);
  return outcome;
}

test.each([
  [4000, 3000, 1600, 1200, 320, 240],
  [3000, 4000, 1200, 1600, 240, 320],
  [200, 100, 200, 100, 200, 100],
])(
  '从 %sx%s 等比生成 %sx%s 与 %sx%s，且小图不放大',
  async (
    width,
    height,
    uploadWidth,
    uploadHeight,
    thumbnailWidth,
    thumbnailHeight,
  ) => {
    const harness = createCodec(width, height);
    const prepared = await preparePhoto(
      new File([Uint8Array.of(1)], 'meal.jpg', { type: 'image/jpeg' }),
      harness.codec,
    );

    expect(prepared).toMatchObject({
      uploadWidth,
      uploadHeight,
      thumbnailWidth,
      thumbnailHeight,
    });
    const requests = harness.encode.mock.calls.map(([, request]) => request);
    expect(requests).toEqual([
      {
        format: 'image/webp',
        longEdge: Math.min(Math.max(width, height), PHOTO_AI_LIMITS.uploadLongEdge),
        quality: 0.82,
      },
      {
        format: 'image/webp',
        longEdge: Math.min(Math.max(width, height), PHOTO_AI_LIMITS.thumbnailLongEdge),
        quality: 0.82,
      },
    ]);
    prepared.dispose();
  },
);

test('upload 每个 edge 依次用 .82/.72/.62/.52，超限后 floor(*.85)', async () => {
  const harness = createCodec();
  let call = 0;
  harness.encode.mockImplementation(async (_source, request) => {
    call += 1;
    return encodedFor(
      4000,
      3000,
      request,
      call <= 4 ? PHOTO_AI_LIMITS.uploadBytes + 1 : 1,
    );
  });

  const prepared = await preparePhoto(
    new File([Uint8Array.of(1)], 'meal.png', { type: 'image/png' }),
    harness.codec,
  );
  const requests = harness.encode.mock.calls.map(([, request]) => request);

  expect(requests.slice(0, 5)).toEqual([
    { format: 'image/webp', longEdge: 1600, quality: 0.82 },
    { format: 'image/webp', longEdge: 1600, quality: 0.72 },
    { format: 'image/webp', longEdge: 1600, quality: 0.62 },
    { format: 'image/webp', longEdge: 1600, quality: 0.52 },
    { format: 'image/webp', longEdge: 1360, quality: 0.82 },
  ]);
  expect(prepared).toMatchObject({ uploadWidth: 1360, uploadHeight: 1020 });
  prepared.dispose();
});

test('thumbnail 独立执行相同质量顺序与严格缩边', async () => {
  const harness = createCodec();
  let call = 0;
  harness.encode.mockImplementation(async (_source, request) => {
    call += 1;
    const isUpload = call === 1;
    return encodedFor(
      4000,
      3000,
      request,
      isUpload || call > 5 ? 1 : PHOTO_AI_LIMITS.thumbnailBytes + 1,
    );
  });

  const prepared = await preparePhoto(
    new File([Uint8Array.of(1)], 'meal.webp', { type: 'image/webp' }),
    harness.codec,
  );
  const requests = harness.encode.mock.calls.map(([, request]) => request);

  expect(requests.slice(1, 6)).toEqual([
    { format: 'image/webp', longEdge: 320, quality: 0.82 },
    { format: 'image/webp', longEdge: 320, quality: 0.72 },
    { format: 'image/webp', longEdge: 320, quality: 0.62 },
    { format: 'image/webp', longEdge: 320, quality: 0.52 },
    { format: 'image/webp', longEdge: 272, quality: 0.82 },
  ]);
  expect(prepared).toMatchObject({ thumbnailWidth: 272, thumbnailHeight: 204 });
  prepared.dispose();
});

test('upload 最多 8 个 edge 轮次，仍超 1MB 后 image-too-large', async () => {
  const harness = createCodec();
  harness.encode.mockImplementation(async (_source, request) =>
    encodedFor(4000, 3000, request, PHOTO_AI_LIMITS.uploadBytes + 1),
  );

  await expect(
    preparePhoto(
      new File([Uint8Array.of(1)], 'meal.jpg', { type: 'image/jpeg' }),
      harness.codec,
    ),
  ).rejects.toMatchObject({ code: 'image-too-large' });
  expect(harness.encode).toHaveBeenCalledTimes(8 * 4);
  expect(harness.dispose).toHaveBeenCalledOnce();
});

test('thumbnail 最多 4 个 edge 轮次，仍超 100KB 后 image-too-large', async () => {
  const harness = createCodec();
  let call = 0;
  harness.encode.mockImplementation(async (_source, request) => {
    call += 1;
    return encodedFor(
      4000,
      3000,
      request,
      call === 1 ? 1 : PHOTO_AI_LIMITS.thumbnailBytes + 1,
    );
  });

  await expect(
    preparePhoto(
      new File([Uint8Array.of(1)], 'meal.jpg', { type: 'image/jpeg' }),
      harness.codec,
    ),
  ).rejects.toMatchObject({ code: 'image-too-large' });
  expect(harness.encode).toHaveBeenCalledTimes(1 + 4 * 4);
  expect(harness.dispose).toHaveBeenCalledOnce();
});

test('只散列最终 upload，返回 lowercase 64 hex，并复制为两个独立 WebP Blob', async () => {
  const harness = createCodec();
  const upload = new Blob(['upload'], { type: 'image/webp' });
  const sharedOutput = upload;
  harness.encode.mockImplementation(async (_source, request) => ({
    ...encodedFor(4000, 3000, request),
    blob: sharedOutput,
  }));
  const digest = vi.spyOn(crypto.subtle, 'digest');

  const prepared = await preparePhoto(
    new File([Uint8Array.of(1)], 'meal.webp', { type: 'image/webp' }),
    harness.codec,
  );

  expect(digest).toHaveBeenCalledOnce();
  expect(prepared.uploadBlobSha256).toBe(
    'ff4085ad157354dc8ea67a848e7c2270b4a19282713cf3a7ecf8e0ffbb159ed1',
  );
  expect(prepared.uploadBlobSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(prepared.uploadBlob).not.toBe(sharedOutput);
  expect(prepared.thumbnailBlob).not.toBe(sharedOutput);
  expect(prepared.uploadBlob).not.toBe(prepared.thumbnailBlob);
  expect(prepared.uploadBlob.type).toBe('image/webp');
  expect(prepared.thumbnailBlob.type).toBe('image/webp');
  prepared.dispose();
});

test.each([
  ['null Blob', null, 1600, 1200],
  ['空 Blob', new Blob([], { type: 'image/webp' }), 1600, 1200],
  ['非 WebP', new Blob([Uint8Array.of(1)], { type: 'image/png' }), 1600, 1200],
  ['零宽', new Blob([Uint8Array.of(1)], { type: 'image/webp' }), 0, 1200],
  ['NaN 高', new Blob([Uint8Array.of(1)], { type: 'image/webp' }), 1600, Number.NaN],
  ['小数宽', new Blob([Uint8Array.of(1)], { type: 'image/webp' }), 1599.5, 1200],
  ['破坏比例', new Blob([Uint8Array.of(1)], { type: 'image/webp' }), 1600, 1199],
])('%s 编码结果 fail closed 为 decode-failed', async (_label, blob, width, height) => {
  const harness = createCodec();
  harness.encode.mockResolvedValue({
    blob: blob as Blob,
    width: width as number,
    height: height as number,
  });

  await expect(
    preparePhoto(
      new File([Uint8Array.of(1)], 'meal.jpg', { type: 'image/jpeg' }),
      harness.codec,
    ),
  ).rejects.toMatchObject({ code: 'decode-failed' });
  expect(harness.dispose).toHaveBeenCalledOnce();
});

test('编码尺寸超过请求 longEdge 时作为 output limit 拒绝', async () => {
  const harness = createCodec();
  harness.encode.mockResolvedValue({
    blob: new Blob([Uint8Array.of(1)], { type: 'image/webp' }),
    width: PHOTO_AI_LIMITS.uploadLongEdge + 1,
    height: 1200,
  });

  await expect(
    preparePhoto(
      new File([Uint8Array.of(1)], 'meal.jpg', { type: 'image/jpeg' }),
      harness.codec,
    ),
  ).rejects.toMatchObject({ code: 'image-too-large' });
  expect(harness.dispose).toHaveBeenCalledOnce();
});

test('SHA-256 失败时清洗 cause 并释放 decoded', async () => {
  const cause = 'hash provider leaked internals';
  const harness = createCodec();
  vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(new Error(cause));

  let caught: unknown;
  try {
    await preparePhoto(
      new File([Uint8Array.of(1)], 'private.jpg', { type: 'image/jpeg' }),
      harness.codec,
    );
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(PhotoPreparationError);
  expect(caught).toMatchObject({ code: 'decode-failed' });
  expect((caught as Error).message).not.toContain(cause);
  expect(harness.dispose).toHaveBeenCalledOnce();
});

test('成功返回的 dispose 幂等，底层释放抛错也不向调用者泄露', async () => {
  const harness = createCodec();
  harness.dispose.mockImplementation(() => {
    throw new Error('release internals');
  });
  const prepared = await preparePhoto(
    new File([Uint8Array.of(1)], 'meal.jpg', { type: 'image/jpeg' }),
    harness.codec,
  );

  expect(() => prepared.dispose()).not.toThrow();
  expect(() => prepared.dispose()).not.toThrow();
  expect(harness.dispose).toHaveBeenCalledOnce();
});

test('编码失败时即使底层 dispose 也失败，仍返回清洗后的 decode-failed', async () => {
  const harness = createCodec();
  harness.encode.mockRejectedValueOnce(new Error('encoder internals'));
  harness.dispose.mockImplementation(() => {
    throw new Error('release internals');
  });

  await expect(
    preparePhoto(
      new File([Uint8Array.of(1)], 'private.jpg', { type: 'image/jpeg' }),
      harness.codec,
    ),
  ).rejects.toMatchObject({ code: 'decode-failed', message: '图片解码失败' });
  expect(harness.dispose).toHaveBeenCalledOnce();
});

test.each(['', 'image/gif', 'image/svg+xml', 'image/jpg'])(
  '拒绝不支持的 MIME %j 且不进入 codec',
  async (type) => {
    const harness = createCodec();
    const filename = 'private-filename.gif';

    await expect(
      preparePhoto(new File([Uint8Array.of(1)], filename, { type }), harness.codec),
    ).rejects.toMatchObject({ code: 'unsupported-file' });
    expect(harness.decode).not.toHaveBeenCalled();
  },
);

test('在首次 await 前同步快照 Blob，变量替换不影响且 filename 不进入 codec', async () => {
  const harness = createCodec();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let received: Blob | undefined;
  harness.decode.mockImplementationOnce(async (file: Blob) => {
    received = file;
    await gate;
    return harness.decoded;
  });
  let selected = new File([Uint8Array.of(1, 2, 3)], 'original.jpg', {
    type: 'image/jpeg',
  });

  const pending = preparePhoto(selected, harness.codec);
  selected = new File([Uint8Array.of(9)], 'replacement.png', {
    type: 'image/png',
  });

  expect(received).toBeInstanceOf(Blob);
  expect(received).not.toBeInstanceOf(File);
  expect(received).toMatchObject({ size: 3, type: 'image/jpeg' });
  expect('name' in (received as Blob)).toBe(false);
  release();
  const prepared = await pending;
  prepared.dispose();
});

test.each([
  [0, 100],
  [-1, 100],
  [100, Number.NaN],
  [100, Number.POSITIVE_INFINITY],
  [100.5, 100],
])('非法解码尺寸 %s x %s fail closed 并释放', async (width, height) => {
  const harness = createCodec(width, height);

  await expect(
    preparePhoto(
      new File([Uint8Array.of(1)], 'invalid.webp', { type: 'image/webp' }),
      harness.codec,
    ),
  ).rejects.toMatchObject({ code: 'decode-failed' });
  expect(harness.encode).not.toHaveBeenCalled();
  expect(harness.dispose).toHaveBeenCalledOnce();
});
