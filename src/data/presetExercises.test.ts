import { BODY_PARTS } from './bodyParts';
import { PRESET_EXERCISES } from './presetExercises';

test('预置动作共 40 个且 id 唯一', () => {
  expect(PRESET_EXERCISES).toHaveLength(40);
  expect(new Set(PRESET_EXERCISES.map((e) => e.id)).size).toBe(40);
});

test('每个动作的部位合法，每个部位至少 4 个动作', () => {
  const valid = new Set(BODY_PARTS.map((p) => p.id));
  for (const e of PRESET_EXERCISES) expect(valid.has(e.bodyPart)).toBe(true);
  for (const p of BODY_PARTS) {
    expect(PRESET_EXERCISES.filter((e) => e.bodyPart === p.id).length).toBeGreaterThanOrEqual(4);
  }
});
