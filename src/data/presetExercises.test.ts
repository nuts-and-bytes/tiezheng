import { BODY_PARTS } from './bodyParts';
import { PRESET_EXERCISES } from './presetExercises';

test('预置动作共 40 个且 id 唯一', () => {
  expect(PRESET_EXERCISES).toHaveLength(40);
  expect(new Set(PRESET_EXERCISES.map((e) => e.id)).size).toBe(40);
});

test('40 个动作的中文 name 全部唯一', () => {
  expect(new Set(PRESET_EXERCISES.map((e) => e.name)).size).toBe(PRESET_EXERCISES.length);
});

test('每个动作的部位合法，每个部位数量精确匹配', () => {
  const valid = new Set(BODY_PARTS.map((p) => p.id));
  for (const e of PRESET_EXERCISES) expect(valid.has(e.bodyPart)).toBe(true);

  const expectedCounts: Record<string, number> = {
    chest: 6,
    shoulder: 6,
    back: 6,
    leg: 6,
    arm: 6,
    core: 4,
    cardio: 6,
  };
  for (const p of BODY_PARTS) {
    expect(PRESET_EXERCISES.filter((e) => e.bodyPart === p.id).length).toBe(expectedCounts[p.id]);
  }
});
