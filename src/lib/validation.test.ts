import { test, expect } from 'vitest';
import {
  LIMITS, sanitizeSets, validBodyWeight, validLoad, validReps, validSetCount,
} from './validation';

test('体重 20–300kg', () => {
  expect(validBodyWeight(20)).toBe(true);
  expect(validBodyWeight(300)).toBe(true);
  expect(validBodyWeight(19.9)).toBe(false);
  expect(validBodyWeight(300.1)).toBe(false);
  expect(validBodyWeight(NaN)).toBe(false);
});

test('组数 1–20 整数', () => {
  expect(validSetCount(1)).toBe(true);
  expect(validSetCount(20)).toBe(true);
  expect(validSetCount(0)).toBe(false);
  expect(validSetCount(21)).toBe(false);
  expect(validSetCount(2.5)).toBe(false);
});

test('重量 0–500kg，次数 1–100 整数', () => {
  expect(validLoad(0)).toBe(true);
  expect(validLoad(500)).toBe(true);
  expect(validLoad(-1)).toBe(false);
  expect(validLoad(501)).toBe(false);
  expect(validReps(1)).toBe(true);
  expect(validReps(100)).toBe(true);
  expect(validReps(0)).toBe(false);
  expect(validReps(3.5)).toBe(false);
});

test('sanitizeSets 剔除非法重量/次数，保留组本身', () => {
  expect(
    sanitizeSets([{ weight: 60, reps: 10 }, { weight: 9999, reps: 0 }, {}]),
  ).toEqual([{ weight: 60, reps: 10 }, {}, {}]);
  expect(LIMITS.sets.max).toBe(20);
});
