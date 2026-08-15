import { stableJson } from './stableJson';

test('object key insertion order does not affect serialization', () => {
  expect(stableJson({ second: 2, first: 1 })).toBe(stableJson({ first: 1, second: 2 }));
});

test('nested object keys are recursively sorted', () => {
  expect(stableJson({ outer: { second: 2, first: 1 } })).toBe(
    '{"outer":{"first":1,"second":2}}',
  );
});

test('undefined object properties are omitted', () => {
  expect(stableJson({ omitted: undefined, keep: 1 })).toBe('{"keep":1}');
});

test('top-level undefined is not a JSON value', () => {
  expect(() => stableJson(undefined)).toThrow('stableJson requires a JSON value');
});

test('undefined array entries become null', () => {
  expect(stableJson([1, undefined, 3])).toBe('[1,null,3]');
});
