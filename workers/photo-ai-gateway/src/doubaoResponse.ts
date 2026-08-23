export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export type ProviderResponseFailureKind =
  | 'http-status'
  | 'invalid-response'
  | 'read-failed';

const MAX_PROVIDER_BYTES = 256_000;
const MAX_OUTPUT_TEXT_CHARS = 100_000;

export class ProviderResponseError extends Error {
  readonly kind: ProviderResponseFailureKind;
  readonly status: number | null;

  constructor(kind: ProviderResponseFailureKind, status: number | null = null) {
    super(kind === 'read-failed' ? 'Provider response read failed' : 'Invalid provider response');
    this.name = 'ProviderResponseError';
    this.kind = kind;
    this.status = status;
  }
}

function invalid(status: number | null = null): never {
  throw new ProviderResponseError(status === null ? 'invalid-response' : 'http-status', status);
}

function readFailed(): never {
  throw new ProviderResponseError('read-failed');
}

function ignoreCancellation(result: Promise<unknown>): void {
  void result.catch(() => undefined);
}

function cancelStream(stream: ReadableStream<Uint8Array> | null): void {
  if (stream === null) return;
  try {
    ignoreCancellation(stream.cancel());
  } catch {
    // Provider-controlled cancellation details never escape.
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    ignoreCancellation(reader.cancel());
  } catch {
    // Provider-controlled cancellation details never escape.
  }
}

const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_TAG_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  Symbol.toStringTag,
)?.get;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  'byteLength',
)?.get;

function uint8ArrayByteLength(value: unknown): number {
  try {
    if (
      TYPED_ARRAY_TAG_GETTER === undefined ||
      TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined ||
      TYPED_ARRAY_TAG_GETTER.call(value) !== 'Uint8Array'
    ) {
      return invalid();
    }
    const length = TYPED_ARRAY_BYTE_LENGTH_GETTER.call(value) as unknown;
    if (!Number.isSafeInteger(length) || Object.is(length, -0) || (length as number) < 1) {
      return invalid();
    }
    return length as number;
  } catch {
    return invalid();
  }
}

function isJsonContentType(value: string | null): boolean {
  return /^application\/json(?:[\t ]*;|$)/i.test(value ?? '');
}

export async function readBoundedProviderText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  if (maximumBytes !== MAX_PROVIDER_BYTES) {
    cancelStream(response.body);
    return invalid();
  }
  if (!response.ok) {
    const status = Number.isSafeInteger(response.status) ? response.status : null;
    cancelStream(response.body);
    return status === null ? invalid() : invalid(status);
  }
  if (!isJsonContentType(response.headers.get('content-type'))) {
    cancelStream(response.body);
    return invalid();
  }
  if (response.body === null) return invalid();

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch {
    cancelStream(response.body);
    return readFailed();
  }

  const bytes = new Uint8Array(MAX_PROVIDER_BYTES);
  let length = 0;
  try {
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch {
        cancelReader(reader);
        return readFailed();
      }
      if (result.done) break;

      try {
        const chunkLength = uint8ArrayByteLength(result.value);
        if (chunkLength > MAX_PROVIDER_BYTES - length) {
          cancelReader(reader);
          return invalid();
        }
        Uint8Array.prototype.set.call(bytes, result.value, length);
        length += chunkLength;
      } catch (error) {
        cancelReader(reader);
        if (error instanceof ProviderResponseError) throw error;
        return invalid();
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Lock release failures are not provider-visible output.
    }
  }

  if (length < 1) return invalid();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
  } catch {
    return invalid();
  }
}

type Snapshot = ReadonlyMap<string, unknown>;

function snapshotOpenObject(value: unknown): Snapshot {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalid();
    const snapshot = new Map<string, unknown>();
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return invalid();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return invalid();
      snapshot.set(key, descriptor.value);
    }
    return snapshot;
  } catch {
    return invalid();
  }
}

function snapshotExactObject(value: unknown, expectedKeys: readonly string[]): Snapshot {
  const snapshot = snapshotOpenObject(value);
  if (
    snapshot.size !== expectedKeys.length ||
    expectedKeys.some((key) => !snapshot.has(key))
  ) {
    return invalid();
  }
  return snapshot;
}

function snapshotArray(value: unknown, maximumLength: number): unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return invalid();
    const ownKeys = Reflect.ownKeys(value);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (
      lengthDescriptor === undefined ||
      !Object.hasOwn(lengthDescriptor, 'value') ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      Object.is(lengthDescriptor.value, -0) ||
      lengthDescriptor.value > maximumLength ||
      ownKeys.length !== lengthDescriptor.value + 1
    ) {
      return invalid();
    }
    const snapshot: unknown[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return invalid();
      snapshot.push(descriptor.value);
    }
    return snapshot;
  } catch {
    return invalid();
  }
}

function tokenCount(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < 0
  ) {
    return invalid();
  }
  return value;
}

function parseUsage(value: unknown): ModelUsage | null {
  if (value === undefined || value === null) return null;
  const snapshot = snapshotOpenObject(value);
  const legacyKeys = ['input_tokens', 'output_tokens'] as const;
  const officialKeys = [
    'input_tokens',
    'input_tokens_details',
    'output_tokens',
    'output_tokens_details',
    'total_tokens',
  ] as const;
  const inputTokens = tokenCount(snapshot.get('input_tokens'));
  const outputTokens = tokenCount(snapshot.get('output_tokens'));

  if (
    snapshot.size === legacyKeys.length &&
    legacyKeys.every((key) => snapshot.has(key))
  ) {
    return { inputTokens, outputTokens };
  }
  if (
    snapshot.size !== officialKeys.length ||
    officialKeys.some((key) => !snapshot.has(key))
  ) {
    return invalid();
  }

  const inputDetails = snapshotExactObject(
    snapshot.get('input_tokens_details'),
    ['cached_tokens'],
  );
  const outputDetails = snapshotExactObject(
    snapshot.get('output_tokens_details'),
    ['reasoning_tokens'],
  );
  const cachedTokens = tokenCount(inputDetails.get('cached_tokens'));
  const reasoningTokens = tokenCount(outputDetails.get('reasoning_tokens'));
  const totalTokens = tokenCount(snapshot.get('total_tokens'));
  const computedTotal = inputTokens + outputTokens;
  if (
    cachedTokens > inputTokens ||
    reasoningTokens > outputTokens ||
    !Number.isSafeInteger(computedTotal) ||
    totalTokens !== computedTotal
  ) {
    return invalid();
  }

  return {
    inputTokens,
    outputTokens,
  };
}

export function parseResponsesOutput(
  envelope: unknown,
): { text: string; usage: ModelUsage | null } {
  try {
    const root = snapshotOpenObject(envelope);
    if (root.get('status') !== 'completed' || !root.has('output')) return invalid();
    const output = snapshotArray(root.get('output'), 8);
    if (output.length !== 1) return invalid();

    const message = snapshotOpenObject(output[0]);
    if (
      message.get('type') !== 'message' ||
      (message.has('status') && message.get('status') !== 'completed') ||
      !message.has('content')
    ) {
      return invalid();
    }
    const content = snapshotArray(message.get('content'), 8);
    if (content.length !== 1) return invalid();

    const item = snapshotOpenObject(content[0]);
    const text = item.get('text');
    if (
      item.get('type') !== 'output_text' ||
      typeof text !== 'string' ||
      text.length < 1 ||
      text.length > MAX_OUTPUT_TEXT_CHARS
    ) {
      return invalid();
    }

    return {
      text,
      usage: parseUsage(root.has('usage') ? root.get('usage') : undefined),
    };
  } catch {
    return invalid();
  }
}
