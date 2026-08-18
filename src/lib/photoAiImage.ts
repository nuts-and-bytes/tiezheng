import { PHOTO_AI_LIMITS } from './photoAiContract';

const SUPPORTED_PHOTO_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const ENCODE_QUALITIES = [0.82, 0.72, 0.62, 0.52] as const;

export interface DecodedPhoto {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
}

export interface EncodePhotoRequest {
  format: 'image/webp';
  longEdge: number;
  quality: number;
}

export interface EncodedPhoto {
  blob: Blob;
  width: number;
  height: number;
}

export interface PhotoCodec {
  decode(file: Blob): Promise<DecodedPhoto>;
  encode(
    source: CanvasImageSource,
    request: EncodePhotoRequest,
  ): Promise<EncodedPhoto>;
}

export interface PreparedPhoto {
  uploadBlob: Blob;
  uploadBlobSha256: string;
  uploadWidth: number;
  uploadHeight: number;
  thumbnailBlob: Blob;
  thumbnailWidth: number;
  thumbnailHeight: number;
  dispose: () => void;
}

type PhotoPreparationErrorCode =
  | 'unsupported-file'
  | 'image-too-large'
  | 'decode-failed';

export class PhotoPreparationError extends Error {
  readonly code: PhotoPreparationErrorCode;

  constructor(code: PhotoPreparationErrorCode, message: string) {
    super(message);
    this.name = 'PhotoPreparationError';
    this.code = code;
  }
}

function fitWithin(width: number, height: number, longEdge: number) {
  const sourceLongEdge = Math.max(width, height);
  if (sourceLongEdge <= longEdge) return { width, height };
  const scale = longEdge / sourceLongEdge;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

function isValidDimension(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function safeOnce(dispose: () => void): () => void {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    try {
      dispose();
    } catch {
      // Resource release must not leak implementation details or mask the main result.
    }
  };
}

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('blob read failed'));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error('blob read failed'));
    };
    reader.readAsArrayBuffer(blob);
  });
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await readBlob(blob));
  if (digest.byteLength !== 32) throw new Error('invalid digest');
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('invalid digest');
  return hex;
}

function imageSourceDimensions(source: CanvasImageSource) {
  const candidate = source as unknown as {
    naturalWidth?: number;
    naturalHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
    width?: number;
    height?: number;
  };
  return {
    width: candidate.naturalWidth ?? candidate.videoWidth ?? candidate.width,
    height: candidate.naturalHeight ?? candidate.videoHeight ?? candidate.height,
  };
}

function decodeWithImage(file: Blob): Promise<DecodedPhoto> {
  return new Promise((resolve, reject) => {
    let objectUrl: string;
    try {
      objectUrl = URL.createObjectURL(file);
    } catch {
      reject(new Error('image decode failed'));
      return;
    }

    const revoke = safeOnce(() => URL.revokeObjectURL(objectUrl));

    let image: HTMLImageElement;
    try {
      image = new Image();
    } catch {
      revoke();
      reject(new Error('image decode failed'));
      return;
    }

    image.onload = () => {
      image.onload = null;
      image.onerror = null;
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      revoke();
      resolve({ source: image, width, height, dispose: () => {} });
    };
    image.onerror = () => {
      image.onload = null;
      image.onerror = null;
      revoke();
      reject(new Error('image decode failed'));
    };

    try {
      image.src = objectUrl;
    } catch {
      image.onload = null;
      image.onerror = null;
      revoke();
      reject(new Error('image decode failed'));
    }
  });
}

async function decodeInBrowser(file: Blob): Promise<DecodedPhoto> {
  const bitmapDecoder = globalThis.createImageBitmap;
  if (typeof bitmapDecoder === 'function') {
    try {
      const bitmap = await bitmapDecoder(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        dispose: () => bitmap.close(),
      };
    } catch {
      // Some browsers expose createImageBitmap but cannot decode HEIC/HEIF.
    }
  }
  return decodeWithImage(file);
}

async function encodeWithCanvas(
  source: CanvasImageSource,
  request: EncodePhotoRequest,
): Promise<EncodedPhoto> {
  const sourceDimensions = imageSourceDimensions(source);
  if (
    !isValidDimension(sourceDimensions.width ?? Number.NaN) ||
    !isValidDimension(sourceDimensions.height ?? Number.NaN)
  ) {
    throw new Error('image encode failed');
  }
  const dimensions = fitWithin(
    sourceDimensions.width as number,
    sourceDimensions.height as number,
    request.longEdge,
  );
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;

  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('image encode failed');
    context.drawImage(source, 0, 0, dimensions.width, dimensions.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      try {
        canvas.toBlob(
          (output) => {
            if (!output || output.type !== request.format) {
              reject(new Error('image encode failed'));
              return;
            }
            resolve(output);
          },
          request.format,
          request.quality,
        );
      } catch {
        reject(new Error('image encode failed'));
      }
    });
    return { blob, ...dimensions };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

const DEFAULT_PHOTO_CODEC: PhotoCodec = {
  decode: decodeInBrowser,
  encode: encodeWithCanvas,
};

async function encodeWithinLimit(
  codec: PhotoCodec,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  initialLongEdge: number,
  maxBytes: number,
  maxEdgeRounds: number,
): Promise<EncodedPhoto> {
  let longEdge = initialLongEdge;
  for (let round = 0; round < maxEdgeRounds; round += 1) {
    for (const quality of ENCODE_QUALITIES) {
      const encoded = await codec.encode(source, {
        format: 'image/webp',
        longEdge,
        quality,
      });
      if (
        !(encoded.blob instanceof Blob) ||
        encoded.blob.size < 1 ||
        encoded.blob.type !== 'image/webp' ||
        !isValidDimension(encoded.width) ||
        !isValidDimension(encoded.height)
      ) {
        throw new PhotoPreparationError('decode-failed', '图片编码失败');
      }
      if (Math.max(encoded.width, encoded.height) > longEdge) {
        throw new PhotoPreparationError('image-too-large', '图片尺寸过大');
      }
      const expected = fitWithin(sourceWidth, sourceHeight, longEdge);
      if (encoded.width !== expected.width || encoded.height !== expected.height) {
        throw new PhotoPreparationError('decode-failed', '图片编码失败');
      }
      if (encoded.blob.size <= maxBytes) return encoded;
    }

    const nextLongEdge = Math.min(longEdge - 1, Math.floor(longEdge * 0.85));
    if (nextLongEdge < 1) break;
    longEdge = nextLongEdge;
  }

  throw new PhotoPreparationError('image-too-large', '图片压缩后仍然过大');
}

export async function preparePhoto(
  file: File,
  codec?: PhotoCodec,
): Promise<PreparedPhoto> {
  const fileType = file.type;
  const fileSize = file.size;
  if (!SUPPORTED_PHOTO_TYPES.has(fileType)) {
    throw new PhotoPreparationError('unsupported-file', '不支持的图片格式');
  }
  if (fileSize > PHOTO_AI_LIMITS.rawBytes) {
    throw new PhotoPreparationError('image-too-large', '图片文件过大');
  }
  const input = new Blob([file], { type: fileType });

  const activeCodec = codec ?? DEFAULT_PHOTO_CODEC;

  let decoded: DecodedPhoto | undefined;
  let releaseDecoded = () => {};
  try {
    decoded = await activeCodec.decode(input);
    if (!decoded || typeof decoded.dispose !== 'function') {
      throw new PhotoPreparationError('decode-failed', '图片解码失败');
    }
    releaseDecoded = safeOnce(decoded.dispose);
    if (!isValidDimension(decoded.width) || !isValidDimension(decoded.height)) {
      throw new PhotoPreparationError('decode-failed', '图片解码失败');
    }
    if (decoded.width > PHOTO_AI_LIMITS.decodedPixels / decoded.height) {
      throw new PhotoPreparationError('image-too-large', '图片尺寸过大');
    }

    const sourceLongEdge = Math.max(decoded.width, decoded.height);
    const upload = await encodeWithinLimit(
      activeCodec,
      decoded.source,
      decoded.width,
      decoded.height,
      Math.min(sourceLongEdge, PHOTO_AI_LIMITS.uploadLongEdge),
      PHOTO_AI_LIMITS.uploadBytes,
      8,
    );
    const thumbnail = await encodeWithinLimit(
      activeCodec,
      decoded.source,
      decoded.width,
      decoded.height,
      Math.min(sourceLongEdge, PHOTO_AI_LIMITS.thumbnailLongEdge),
      PHOTO_AI_LIMITS.thumbnailBytes,
      4,
    );

    const uploadBlob = upload.blob.slice(0, upload.blob.size, 'image/webp');
    const thumbnailBlob = thumbnail.blob.slice(
      0,
      thumbnail.blob.size,
      'image/webp',
    );
    const uploadBlobSha256 = await sha256Hex(uploadBlob);

    return {
      uploadBlob,
      uploadBlobSha256,
      uploadWidth: upload.width,
      uploadHeight: upload.height,
      thumbnailBlob,
      thumbnailWidth: thumbnail.width,
      thumbnailHeight: thumbnail.height,
      dispose: releaseDecoded,
    };
  } catch (error) {
    releaseDecoded();
    if (error instanceof PhotoPreparationError) throw error;
    throw new PhotoPreparationError('decode-failed', '图片解码失败');
  }
}
