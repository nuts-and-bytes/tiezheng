function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => (entry === undefined ? null : normalize(entry)));
  }

  if (value !== null && typeof value === 'object') {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = Reflect.get(value, key);
      if (entry !== undefined) normalized[key] = normalize(entry);
    }
    return normalized;
  }

  return value;
}

export function stableJson(value: unknown): string {
  const result = JSON.stringify(normalize(value));
  if (result === undefined) throw new Error('stableJson requires a JSON value');
  return result;
}
