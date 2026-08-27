const SUBJECT = /^(?=.{1,128}$)[\x21-\x7e]+$/;

export async function deriveOpaqueKey(subject: string, secret: string): Promise<string> {
  try {
    if (typeof subject !== 'string' || !SUBJECT.test(subject)) throw new TypeError();
    if (
      typeof secret !== 'string'
      || new TextEncoder().encode(secret).byteLength < 32
    ) {
      throw new TypeError();
    }

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { hash: 'SHA-256', name: 'HMAC' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(subject));
    return Array.from(
      new Uint8Array(signature),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
  } catch {
    throw new Error('Access denied');
  }
}
