import {
  PHOTO_AI_LIMITS,
  PHOTO_AI_VERSIONS,
  type PhotoAiRequestMetadata,
} from '../../../src/lib/photoAiContract';

const MAX_MULTIPART_BYTES = 1_100_000;
const MAX_EDGE = 12_000;
const MAX_ASPECT_RATIO = 20;
const MAX_TEXT_FIELD_BYTES = 512;
const INVALID_UPLOAD = 'invalid photo upload';
const METADATA_FIELDS = [
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
const MULTIPART_FIELDS = new Set<string>(['image', ...METADATA_FIELDS]);

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export interface BoundedPhotoUpload {
  readonly bytes: Uint8Array;
  readonly mime: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly width: number;
  readonly height: number;
  readonly metadata: PhotoAiRequestMetadata;
}

export interface SanitizedImage {
  readonly bytes: Uint8Array;
  readonly mime: 'image/webp';
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

type ParsedImage = Pick<BoundedPhotoUpload, 'mime' | 'width' | 'height'>;

function invalidUpload(): never {
  throw new TypeError(INVALID_UPLOAD);
}

function ascii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

function equalsAt(bytes: Uint8Array, value: Uint8Array, index: number): boolean {
  if (index < 0 || index + value.length > bytes.length) return false;
  for (let offset = 0; offset < value.length; offset += 1) {
    if (bytes[index + offset] !== value[offset]) return false;
  }
  return true;
}

function indexOf(bytes: Uint8Array, value: Uint8Array, from = 0): number {
  for (let index = from; index + value.length <= bytes.length; index += 1) {
    if (equalsAt(bytes, value, index)) return index;
  }
  return -1;
}

function multipartBoundaryIndex(bytes: Uint8Array, separator: Uint8Array, from: number): number {
  let candidate = indexOf(bytes, separator, from);
  while (candidate >= 0) {
    const suffix = candidate + separator.length;
    if (equalsAt(bytes, Uint8Array.of(45, 45), suffix)
      || equalsAt(bytes, Uint8Array.of(13, 10), suffix)) return candidate;
    candidate = indexOf(bytes, separator, candidate + 1);
  }
  return -1;
}

function u16be(bytes: Uint8Array, index: number): number {
  if (index + 2 > bytes.length) return invalidUpload();
  return (bytes[index] << 8) | bytes[index + 1];
}

function u16le(bytes: Uint8Array, index: number): number {
  if (index + 2 > bytes.length) return invalidUpload();
  return bytes[index] | (bytes[index + 1] << 8);
}

function u24le(bytes: Uint8Array, index: number): number {
  if (index + 3 > bytes.length) return invalidUpload();
  return bytes[index] | (bytes[index + 1] << 8) | (bytes[index + 2] << 16);
}

function u32be(bytes: Uint8Array, index: number): number {
  if (index + 4 > bytes.length) return invalidUpload();
  return ((bytes[index] * 0x1000000) + ((bytes[index + 1] << 16) | (bytes[index + 2] << 8) | bytes[index + 3]));
}

function u32le(bytes: Uint8Array, index: number): number {
  if (index + 4 > bytes.length) return invalidUpload();
  return bytes[index] + bytes[index + 1] * 0x100 + bytes[index + 2] * 0x10000 + bytes[index + 3] * 0x1000000;
}

function dimensions(width: number, height: number): { width: number; height: number } {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    return invalidUpload();
  }
  if (width > MAX_EDGE || height > MAX_EDGE || width * height > PHOTO_AI_LIMITS.decodedPixels) {
    return invalidUpload();
  }
  if (Math.max(width, height) / Math.min(width, height) > MAX_ASPECT_RATIO) return invalidUpload();
  return { width, height };
}

function parseJpeg(bytes: Uint8Array): ParsedImage {
  if (!equalsAt(bytes, Uint8Array.of(0xff, 0xd8), 0)) return invalidUpload();
  let index = 2;
  let value: { width: number; height: number } | undefined;
  while (index < bytes.length) {
    if (bytes[index] !== 0xff) return invalidUpload();
    while (bytes[index] === 0xff) index += 1;
    const marker = bytes[index++];
    if (marker === undefined || marker === 0x00) return invalidUpload();
    if (marker === 0xd9) return value === undefined || index !== bytes.length ? invalidUpload() : { mime: 'image/jpeg', ...value };
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = u16be(bytes, index);
    if (length < 2 || index + length > bytes.length) return invalidUpload();
    if (marker === 0xe2 && equalsAt(bytes, Uint8Array.of(0x4d, 0x50, 0x46, 0x00), index + 2)) return invalidUpload();
    if (marker === 0xda) {
      index += length;
      const eoi = indexOf(bytes, Uint8Array.of(0xff, 0xd9), index);
      if (eoi < 0 || eoi + 2 !== bytes.length || value === undefined) return invalidUpload();
      return { mime: 'image/jpeg', ...value };
    }
    const isSof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      if (length < 8) return invalidUpload();
      value = dimensions(u16be(bytes, index + 5), u16be(bytes, index + 3));
    }
    index += length;
  }
  return invalidUpload();
}

function parsePng(bytes: Uint8Array): ParsedImage {
  if (!equalsAt(bytes, Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), 0)) return invalidUpload();
  let index = 8;
  let value: { width: number; height: number } | undefined;
  let first = true;
  while (index < bytes.length) {
    const length = u32be(bytes, index);
    const typeStart = index + 4;
    const dataStart = index + 8;
    const end = dataStart + length + 4;
    if (end > bytes.length) return invalidUpload();
    const type = ascii(bytes.subarray(typeStart, typeStart + 4));
    if (first) {
      if (type !== 'IHDR' || length !== 13) return invalidUpload();
      value = dimensions(u32be(bytes, dataStart), u32be(bytes, dataStart + 4));
      first = false;
    }
    if (type === 'acTL') return invalidUpload();
    if (type === 'IEND') return value === undefined || index + 12 !== bytes.length ? invalidUpload() : { mime: 'image/png', ...value };
    index = end;
  }
  return invalidUpload();
}

function parseWebp(bytes: Uint8Array): ParsedImage {
  if (!equalsAt(bytes, encoder.encode('RIFF'), 0) || !equalsAt(bytes, encoder.encode('WEBP'), 8)) return invalidUpload();
  if (u32le(bytes, 4) + 8 !== bytes.length) return invalidUpload();
  let index = 12;
  let value: { width: number; height: number } | undefined;
  while (index < bytes.length) {
    if (index + 8 > bytes.length) return invalidUpload();
    const type = ascii(bytes.subarray(index, index + 4));
    const length = u32le(bytes, index + 4);
    const data = index + 8;
    const next = data + length + (length & 1);
    if (next > bytes.length) return invalidUpload();
    if (type === 'ANIM' || type === 'ANMF') return invalidUpload();
    if (type === 'VP8 ' && length >= 10 && equalsAt(bytes, Uint8Array.of(0x9d, 0x01, 0x2a), data + 3)) {
      value = dimensions(u16le(bytes, data + 6) & 0x3fff, u16le(bytes, data + 8) & 0x3fff);
    } else if (type === 'VP8L' && length >= 5 && bytes[data] === 0x2f) {
      const packed = u32le(bytes, data + 1);
      value = dimensions((packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1);
    } else if (type === 'VP8X' && length === 10) {
      if ((bytes[data] & 0x02) !== 0) return invalidUpload();
      value = dimensions(u24le(bytes, data + 4) + 1, u24le(bytes, data + 7) + 1);
    }
    index = next;
  }
  return value === undefined ? invalidUpload() : { mime: 'image/webp', ...value };
}

function parseImage(bytes: Uint8Array): ParsedImage {
  if (bytes.length === 0 || bytes.length > PHOTO_AI_LIMITS.uploadBytes) return invalidUpload();
  if (equalsAt(bytes, Uint8Array.of(0xff, 0xd8), 0)) return parseJpeg(bytes);
  if (equalsAt(bytes, Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), 0)) return parsePng(bytes);
  if (equalsAt(bytes, encoder.encode('RIFF'), 0)) return parseWebp(bytes);
  return invalidUpload();
}

async function readBounded(stream: ReadableStream<Uint8Array>, maximum: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const remaining = maximum - length;
      const bounded = result.value.slice(0, Math.min(result.value.byteLength, remaining + 1));
      if (result.value.byteLength > remaining) {
        try {
          await reader.cancel();
        } catch {
          // A producer-side cancellation failure must not disclose implementation details.
        }
        return invalidUpload();
      }
      length += bounded.byteLength;
      chunks.push(bounded);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Lock release cannot change the caller-visible validation result.
    }
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function exactMetadata(value: unknown): PhotoAiRequestMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalidUpload();
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).length !== METADATA_FIELDS.length || METADATA_FIELDS.some((key) => !Object.prototype.hasOwnProperty.call(fields, key))) return invalidUpload();
  if (typeof fields.requestId !== 'string' || fields.requestId.length === 0 || fields.requestId.length > 120) return invalidUpload();
  if (typeof fields.idempotencyKey !== 'string' || !/^[a-f0-9]{32}$/.test(fields.idempotencyKey)) return invalidUpload();
  if (typeof fields.uploadBlobSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(fields.uploadBlobSha256)) return invalidUpload();
  if (fields.modelVersion !== PHOTO_AI_VERSIONS.model || fields.promptVersion !== PHOTO_AI_VERSIONS.prompt || fields.schemaVersion !== PHOTO_AI_VERSIONS.schema || fields.catalogVersion !== PHOTO_AI_VERSIONS.catalog || fields.transformVersion !== PHOTO_AI_VERSIONS.transform || fields.uncertaintyVersion !== PHOTO_AI_VERSIONS.uncertainty || fields.providerPolicyVersion !== PHOTO_AI_VERSIONS.providerPolicy || fields.locale !== 'zh-CN') return invalidUpload();
  return fields as unknown as PhotoAiRequestMetadata;
}

function safeText(bytes: Uint8Array): string {
  if (bytes.length === 0 || bytes.length > MAX_TEXT_FIELD_BYTES) return invalidUpload();
  const value = decoder.decode(bytes);
  if (/[\u0000-\u001f\u007f]/.test(value)) return invalidUpload();
  return value;
}

function metadataFromFields(fields: ReadonlyMap<string, string>): PhotoAiRequestMetadata {
  if (fields.size !== METADATA_FIELDS.length || METADATA_FIELDS.some((name) => !fields.has(name))) return invalidUpload();
  const metadata = Object.create(null) as Record<string, string>;
  for (const name of METADATA_FIELDS) metadata[name] = fields.get(name)!;
  return exactMetadata(metadata);
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
  if (digest.byteLength !== 32) return invalidUpload();
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

function boundaryFrom(contentType: string | null): string {
  const match = /^multipart\/form-data\s*;\s*boundary=(?:"([^"\r\n]+)"|([^;\s\r\n]+))\s*$/i.exec(contentType ?? '');
  const boundary = match?.[1] ?? match?.[2];
  if (boundary === undefined || boundary.length === 0 || boundary.length > 70) return invalidUpload();
  return boundary;
}

function partName(headers: string): { name: string; type: string | undefined; file: boolean } {
  const lines = headers.split('\r\n');
  const values = new Map<string, string>();
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator <= 0) return invalidUpload();
    const key = line.slice(0, separator).toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (values.has(key) || (key !== 'content-disposition' && key !== 'content-type')) return invalidUpload();
    values.set(key, value);
  }
  const disposition = values.get('content-disposition');
  const match = /^form-data;\s*name="([^"\r\n]{1,64})"(?:;\s*filename="([^"\r\n]{1,255})")?$/i.exec(disposition ?? '');
  if (match === null) return invalidUpload();
  if (!MULTIPART_FIELDS.has(match[1])) return invalidUpload();
  return { name: match[1], type: values.get('content-type')?.toLowerCase(), file: match[2] !== undefined };
}

export async function readPhotoUpload(request: Request): Promise<BoundedPhotoUpload> {
  try {
    if (request.method !== 'POST' || request.body === null) return invalidUpload();
    const declaredLength = request.headers.get('content-length');
    if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_MULTIPART_BYTES)) return invalidUpload();
    const boundary = encoder.encode(`--${boundaryFrom(request.headers.get('content-type'))}`);
    const bytes = await readBounded(request.body, MAX_MULTIPART_BYTES);
    if (!equalsAt(bytes, boundary, 0) || !equalsAt(bytes, Uint8Array.of(13, 10), boundary.length)) return invalidUpload();
    const separator = encoder.encode(`\r\n--${decoder.decode(boundary.subarray(2))}`);
    const headerEnd = Uint8Array.of(13, 10, 13, 10);
    let index = boundary.length + 2;
    let image: { bytes: Uint8Array; type: string | undefined } | undefined;
    const metadataFields = new Map<string, string>();
    let complete = false;
    while (!complete) {
      const headerStop = indexOf(bytes, headerEnd, index);
      if (headerStop < 0) return invalidUpload();
      const header = decoder.decode(bytes.subarray(index, headerStop));
      const part = partName(header);
      const bodyStart = headerStop + headerEnd.length;
      const bodyStop = multipartBoundaryIndex(bytes, separator, bodyStart);
      if (bodyStop < 0) return invalidUpload();
      const body = bytes.slice(bodyStart, bodyStop);
      if (part.name === 'image') {
        if (image !== undefined || !part.file || part.type === undefined) return invalidUpload();
        image = { bytes: body, type: part.type };
      } else {
        if (part.file || (part.type !== undefined && part.type !== 'text/plain;charset=utf-8') || metadataFields.has(part.name)) return invalidUpload();
        metadataFields.set(part.name, safeText(body));
      }
      index = bodyStop + separator.length;
      if (equalsAt(bytes, Uint8Array.of(45, 45), index)) {
        index += 2;
        if (equalsAt(bytes, Uint8Array.of(13, 10), index)) index += 2;
        if (index !== bytes.length) return invalidUpload();
        complete = true;
      } else if (equalsAt(bytes, Uint8Array.of(13, 10), index)) {
        index += 2;
      } else return invalidUpload();
    }
    if (image === undefined) return invalidUpload();
    const metadata = metadataFromFields(metadataFields);
    const parsed = parseImage(image.bytes);
    if (image.type !== parsed.mime) return invalidUpload();
    const digest = await sha256(image.bytes);
    if (!constantTimeEqual(metadata.uploadBlobSha256, digest)) return invalidUpload();
    return { bytes: image.bytes.slice(), metadata, ...parsed };
  } catch {
    return invalidUpload();
  }
}

function imageStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const copy = bytes.slice();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(copy);
      controller.close();
    },
  });
}

function scaledDimensions(width: number, height: number): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= PHOTO_AI_LIMITS.uploadLongEdge) return { width, height };
  const scale = PHOTO_AI_LIMITS.uploadLongEdge / longEdge;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export async function sanitizeImage(upload: BoundedPhotoUpload, images: ImagesBinding): Promise<SanitizedImage> {
  try {
    const bytes = upload.bytes.slice();
    const mime = upload.mime;
    const width = upload.width;
    const height = upload.height;
    const parsedInput = parseImage(bytes);
    if (parsedInput.mime !== mime || parsedInput.width !== width || parsedInput.height !== height) return invalidUpload();
    const info = await images.info(imageStream(bytes));
    if (!('width' in info)
      || info.format !== mime
      || info.fileSize !== bytes.byteLength
      || info.width !== width
      || info.height !== height) return invalidUpload();
    const expected = scaledDimensions(width, height);
    const transformation = images.input(imageStream(bytes))
      .transform({ width: expected.width, height: expected.height, fit: 'scale-down' });
    const result = await transformation.output({ format: 'image/webp', quality: 80, anim: false });
    const response = result.response();
    if (response.body === null) return invalidUpload();
    const outputBytes = await readBounded(response.body, PHOTO_AI_LIMITS.uploadBytes);
    const parsedOutput = parseImage(outputBytes);
    if (parsedOutput.mime !== 'image/webp' || parsedOutput.width !== expected.width || parsedOutput.height !== expected.height) return invalidUpload();
    return { bytes: outputBytes.slice(), mime: 'image/webp', width: parsedOutput.width, height: parsedOutput.height, sha256: await sha256(outputBytes) };
  } catch {
    return invalidUpload();
  }
}
