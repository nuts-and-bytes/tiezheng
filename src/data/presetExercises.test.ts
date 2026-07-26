import { BODY_PARTS } from './bodyParts';
import { PRESET_EXERCISES } from './presetExercises';

test('预置动作共 42 个且 id 唯一', () => {
  expect(PRESET_EXERCISES).toHaveLength(42);
  expect(new Set(PRESET_EXERCISES.map((e) => e.id)).size).toBe(42);
  expect(PRESET_EXERCISES).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'p-assisted-pullup', bodyPart: 'back', loadMode: 'assistance' }),
    expect.objectContaining({ id: 'p-assisted-dip', bodyPart: 'chest', loadMode: 'assistance' }),
  ]));
});

test('42 个动作的中文 name 全部唯一', () => {
  expect(new Set(PRESET_EXERCISES.map((e) => e.name)).size).toBe(PRESET_EXERCISES.length);
});

test('辅助动作在胸背预设中的顺序稳定', () => {
  expect(PRESET_EXERCISES.filter((e) => e.bodyPart === 'chest').map((e) => e.id)).toEqual([
    'p-bench', 'p-incline-bench', 'p-db-fly', 'p-dip', 'p-assisted-dip', 'p-cable-fly', 'p-pushup',
  ]);
  expect(PRESET_EXERCISES.filter((e) => e.bodyPart === 'back').map((e) => e.id)).toEqual([
    'p-pullup', 'p-assisted-pullup', 'p-lat-pulldown', 'p-bb-row', 'p-seated-row',
    'p-straight-arm', 'p-deadlift',
  ]);
});

test('每个动作的部位合法，每个部位数量精确匹配', () => {
  const valid = new Set(BODY_PARTS.map((p) => p.id));
  for (const e of PRESET_EXERCISES) expect(valid.has(e.bodyPart)).toBe(true);

  const expectedCounts: Record<string, number> = {
    chest: 7,
    shoulder: 6,
    back: 7,
    leg: 6,
    arm: 6,
    core: 4,
    cardio: 6,
  };
  for (const p of BODY_PARTS) {
    expect(PRESET_EXERCISES.filter((e) => e.bodyPart === p.id).length).toBe(expectedCounts[p.id]);
  }
});
