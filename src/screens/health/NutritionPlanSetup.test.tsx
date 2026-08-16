import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { getEffectiveNutritionPlan, listNutritionPlans } from '../../repos/nutritionPlanRepo';
import * as nutritionPlanRepo from '../../repos/nutritionPlanRepo';
import { getWeight, setWeight } from '../../repos/weightRepo';
import { resetDb } from '../../test/dbTestUtils';
import { nutritionPlanRow } from '../../test/nutritionFixtures';
import {
  deriveTargetSchedule,
  draftFromPlanForm,
  NUTRITION_DISCLAIMER,
  NutritionPlanDetails,
  NutritionPlanSetup,
} from './NutritionPlanSetup';

const SHARED_SAFETY_LABELS = [
  '孕期或哺乳期',
  '需治疗性饮食',
  '肾病或复杂疾病',
  '进食障碍或 RED-S 风险',
  '运动员或极高活动量',
] as const;

beforeEach(resetDb);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function waitForSetup() {
  return screen.findByRole('button', { name: '保存健康计划' });
}

async function fillSharedSafety(
  user: ReturnType<typeof userEvent.setup>,
  overrides: Partial<Record<(typeof SHARED_SAFETY_LABELS)[number], 'yes' | 'no'>> = {},
) {
  for (const label of SHARED_SAFETY_LABELS) {
    await user.selectOptions(screen.getByLabelText(label), overrides[label] ?? 'no');
  }
}

async function fillMuscleFields(
  user: ReturnType<typeof userEvent.setup>,
  options: { age?: string; highBodyFat?: 'yes' | 'no' } = {},
) {
  await user.type(screen.getByLabelText('年龄'), options.age ?? '30');
  await user.selectOptions(screen.getByLabelText('蛋白质计算体重'), 'current-weight');
  await user.selectOptions(
    screen.getByLabelText('高体脂或肥胖'),
    options.highBodyFat ?? 'no',
  );
  await fillSharedSafety(user);
}

async function fillFatLossFields(
  user: ReturnType<typeof userEvent.setup>,
  options: {
    age?: string;
    height?: string;
    targetWeight?: string;
    weeklyLoss?: string;
  } = {},
) {
  await user.type(screen.getByLabelText('年龄'), options.age ?? '30');
  await user.type(screen.getByLabelText('身高（厘米）'), options.height ?? '175');
  await user.selectOptions(screen.getByLabelText('方程分支'), 'female');
  await user.selectOptions(screen.getByLabelText('活动类别下界'), 'low-active');
  await user.selectOptions(screen.getByLabelText('活动类别上界'), 'active');
  await user.selectOptions(screen.getByLabelText('职业活动'), 'mixed');
  await user.type(screen.getByLabelText('主动通勤分钟/天'), '20');
  await user.type(screen.getByLabelText('家务分钟/天'), '30');
  await user.type(screen.getByLabelText('步数/天'), '8000');
  await user.selectOptions(screen.getByLabelText('训练类型'), 'resistance');
  await user.type(screen.getByLabelText('训练次数/周'), '4');
  await user.type(screen.getByLabelText('每次训练分钟'), '60');
  await user.selectOptions(screen.getByLabelText('训练强度'), 'moderate');
  await user.type(screen.getByLabelText('目标体重（公斤）'), options.targetWeight ?? '76');
  await user.type(screen.getByLabelText('每周减重（公斤）'), options.weeklyLoss ?? '0.5');
  await fillSharedSafety(user);
}

async function fillDualFields(user: ReturnType<typeof userEvent.setup>) {
  await fillFatLossFields(user, { targetWeight: '72', weeklyLoss: '0.5' });
  await user.selectOptions(screen.getByLabelText('蛋白质计算体重'), 'current-weight');
  await user.selectOptions(screen.getByLabelText('高体脂或肥胖'), 'no');
}

async function chooseGoalWithManualWeight(
  user: ReturnType<typeof userEvent.setup>,
  goal: '增肌' | '减脂',
  weight = '80',
) {
  await user.click(screen.getByLabelText(goal));
  await user.type(await screen.findByLabelText('当前体重（公斤）'), weight);
  await user.click(screen.getByLabelText('确认使用这条体重'));
}

async function waitForSavedPlan(date = '2026-08-14') {
  await waitFor(async () => {
    expect(await getEffectiveNutritionPlan(date)).toBeDefined();
  });
  await waitFor(() => {
    expect(screen.queryByLabelText('当前体重（公斤）')).not.toBeInTheDocument();
  });
  return getEffectiveNutritionPlan(date);
}

function setValue(form: FormData, name: string, value: string) {
  form.set(name, value);
  return form;
}

function addSharedSafety(form: FormData) {
  for (const name of [
    'pregnantOrBreastfeeding',
    'requiresTherapeuticDiet',
    'kidneyDiseaseOrComplexCondition',
    'eatingDisorderOrRedsRisk',
    'athleteOrExtremeActivity',
  ]) {
    form.set(name, 'no');
  }
  return form;
}

function muscleForm() {
  const form = new FormData();
  form.set('ageYears', '30');
  form.set('proteinWeightMethod', 'current-weight');
  form.set('highBodyFatOrObesity', 'no');
  return addSharedSafety(form);
}

function fatLossForm() {
  const form = new FormData();
  form.set('ageYears', '30');
  form.set('heightCm', '175');
  form.set('equationBranch', 'female');
  form.set('activityCategoryLow', 'low-active');
  form.set('activityCategoryHigh', 'active');
  form.set('occupation', 'mixed');
  form.set('activeCommuteMinutesPerDay', '20');
  form.set('householdMinutesPerDay', '30');
  form.set('stepsPerDay', '8000');
  form.set('trainingType', 'resistance');
  form.set('trainingSessionsPerWeek', '4');
  form.set('trainingMinutesPerSession', '60');
  form.set('trainingIntensity', 'moderate');
  form.set('targetWeightKg', '76');
  form.set('targetLossKgPerWeek', '0.5');
  return addSharedSafety(form);
}

const BASIS_WEIGHT = { weightKg: 80, weightDate: '2026-08-14' } as const;

test('目标体重和周速度是唯一权威输入，并稳定推算只读目标日期', () => {
  expect(deriveTargetSchedule(80, 72, '2026-08-14', 0.459)).toEqual({
    targetDate: '2026-12-14',
    targetLossKgPerWeek: 0.459,
  });
  expect(deriveTargetSchedule(80, 76, '2026-08-14', 0.5)).toEqual({
    targetDate: '2026-10-09',
    targetLossKgPerWeek: 0.5,
  });
});

test('无法用整天表示的速度、同体重和非法速度都给出明确错误', () => {
  expect(() => deriveTargetSchedule(80, 76, '2026-08-14', 0.501)).toThrow(
    '无法按整天推算',
  );
  expect(() => deriveTargetSchedule(80, 80, '2026-08-14', 0.5)).toThrow(
    '目标体重必须低于计算体重',
  );
  expect(() => deriveTargetSchedule(80, 76, '2026-08-14', 0)).toThrow(
    '每周减重必须是大于 0 的有限数',
  );
});

test('历史体重推算出的目标日期不得早于或等于计划日期', () => {
  expect(() =>
    draftFromPlanForm(
      setValue(fatLossForm(), 'targetWeightKg', '79'),
      '2026-08-14',
      { weightKg: 80, weightDate: '2026-07-01' },
      { muscleGain: false, fatLoss: true },
      true,
    ),
  ).toThrow('推算目标日期必须晚于计划日期');
});

test('muscle-only mapper 只要求年龄、蛋白与共享安全字段，未用维度 canonical', () => {
  const draft = draftFromPlanForm(
    muscleForm(),
    '2026-08-14',
    BASIS_WEIGHT,
    { muscleGain: true, fatLoss: false },
    true,
  );

  expect(draft.safetyInputs).toMatchObject({
    ageYears: 30,
    heightCm: null,
    targetWeightKg: null,
    targetLossKgPerWeek: null,
    targetDate: null,
    proteinWeightMethod: 'current-weight',
    highBodyFatOrObesity: false,
  });
  expect(draft.equationInputs).toEqual({
    equationBranch: 'unavailable',
    activityCategoryLow: null,
    activityCategoryHigh: null,
    activityInputs: {
      assessmentStatus: 'not-provided',
      occupation: 'not-provided',
      activeCommuteMinutesPerDay: null,
      householdMinutesPerDay: null,
      stepsPerDay: null,
      trainingTypes: [],
      trainingSessionsPerWeek: null,
      trainingMinutesPerSession: null,
      trainingIntensity: 'not-provided',
    },
  });
});

test('fatloss-only mapper 不要求蛋白体重法和高体脂字段，并完整保留 NASEM 输入', () => {
  const draft = draftFromPlanForm(
    fatLossForm(),
    '2026-08-14',
    BASIS_WEIGHT,
    { muscleGain: false, fatLoss: true },
    true,
  );

  expect(draft.safetyInputs).toMatchObject({
    ageYears: 30,
    heightCm: 175,
    proteinWeightMethod: null,
    highBodyFatOrObesity: null,
    targetWeightKg: 76,
    targetLossKgPerWeek: 0.5,
    targetDate: '2026-10-09',
  });
  expect(draft.equationInputs).toMatchObject({
    equationBranch: 'female',
    activityCategoryLow: 'low-active',
    activityCategoryHigh: 'active',
    activityInputs: {
      assessmentStatus: 'complete',
      occupation: 'mixed',
      trainingTypes: ['resistance'],
    },
  });
});

test('runtime mapper 拒绝缺失数字、非有限数字、非法 enum 与非法 yes-no', () => {
  const missingAge = fatLossForm();
  missingAge.delete('ageYears');
  expect(() =>
    draftFromPlanForm(
      missingAge,
      '2026-08-14',
      BASIS_WEIGHT,
      { muscleGain: false, fatLoss: true },
      true,
    ),
  ).toThrow('ageYears');

  expect(() =>
    draftFromPlanForm(
      setValue(fatLossForm(), 'heightCm', 'Infinity'),
      '2026-08-14',
      BASIS_WEIGHT,
      { muscleGain: false, fatLoss: true },
      true,
    ),
  ).toThrow('heightCm');

  expect(() =>
    draftFromPlanForm(
      setValue(fatLossForm(), 'equationBranch', 'other'),
      '2026-08-14',
      BASIS_WEIGHT,
      { muscleGain: false, fatLoss: true },
      true,
    ),
  ).toThrow('equationBranch');

  expect(() =>
    draftFromPlanForm(
      setValue(fatLossForm(), 'pregnantOrBreastfeeding', 'maybe'),
      '2026-08-14',
      BASIS_WEIGHT,
      { muscleGain: false, fatLoss: true },
      true,
    ),
  ).toThrow('pregnantOrBreastfeeding');
});

test('runtime mapper 拒绝重复 scalar、非十进制、越界和应为整数的数字', () => {
  const duplicate = fatLossForm();
  duplicate.append('ageYears', '31');
  expect(() =>
    draftFromPlanForm(
      duplicate,
      '2026-08-14',
      BASIS_WEIGHT,
      { muscleGain: false, fatLoss: true },
      true,
    ),
  ).toThrow('ageYears');

  for (const [field, value] of [
    ['ageYears', '30.5'],
    ['ageYears', '121'],
    ['heightCm', '0xAF'],
    ['stepsPerDay', '-1'],
    ['trainingSessionsPerWeek', '15'],
  ] as const) {
    expect(() =>
      draftFromPlanForm(
        setValue(fatLossForm(), field, value),
        '2026-08-14',
        BASIS_WEIGHT,
        { muscleGain: false, fatLoss: true },
        true,
      ),
    ).toThrow(field);
  }
});

test('runtime mapper 拒绝逆序或非相邻活动范围，并把 none 训练写成 canonical', () => {
  expect(() =>
    draftFromPlanForm(
      setValue(fatLossForm(), 'activityCategoryHigh', 'very-active'),
      '2026-08-14',
      BASIS_WEIGHT,
      { muscleGain: false, fatLoss: true },
      true,
    ),
  ).toThrow('相邻且升序');

  expect(() =>
    draftFromPlanForm(
      setValue(
        setValue(fatLossForm(), 'activityCategoryLow', 'active'),
        'activityCategoryHigh',
        'low-active',
      ),
      '2026-08-14',
      BASIS_WEIGHT,
      { muscleGain: false, fatLoss: true },
      true,
    ),
  ).toThrow('相邻且升序');

  const none = fatLossForm();
  none.set('trainingType', 'none');
  none.set('trainingSessionsPerWeek', '9');
  none.set('trainingMinutesPerSession', '90');
  none.set('trainingIntensity', 'vigorous');
  expect(
    draftFromPlanForm(
      none,
      '2026-08-14',
      BASIS_WEIGHT,
      { muscleGain: false, fatLoss: true },
      true,
    ).equationInputs.activityInputs,
  ).toMatchObject({
    trainingTypes: ['none'],
    trainingSessionsPerWeek: 0,
    trainingMinutesPerSession: 0,
    trainingIntensity: 'none',
  });

  const contradictory = fatLossForm();
  contradictory.append('trainingType', 'none');
  expect(() =>
    draftFromPlanForm(
      contradictory,
      '2026-08-14',
      BASIS_WEIGHT,
      { muscleGain: false, fatLoss: true },
      true,
    ),
  ).toThrow('无训练');
});

test('非 none 训练不暴露不可保存的“无”强度，none 自动显示 canonical 强度', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  const user = userEvent.setup();
  render(<NutritionPlanSetup date="2026-08-14" onSaved={() => undefined} />);
  await waitForSetup();
  await user.click(screen.getByLabelText('减脂'));
  const intensity = screen.getByLabelText('训练强度') as HTMLSelectElement;
  expect(Array.from(intensity.options).map((option) => option.value)).not.toContain('none');

  await user.selectOptions(screen.getByLabelText('训练类型'), 'none');
  expect(intensity).toBeDisabled();
  expect(intensity).toHaveValue('none');
});

test('活动类别保留稳定 value，同时向用户显示中文标签', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  const user = userEvent.setup();
  render(<NutritionPlanSetup date="2026-08-14" onSaved={() => undefined} />);
  await waitForSetup();
  await user.click(screen.getByLabelText('减脂'));
  const low = screen.getByLabelText('活动类别下界') as HTMLSelectElement;
  expect(Array.from(low.options).find((option) => option.value === 'low-active')).toHaveTextContent(
    '低活动',
  );
});

test('flag off 改 basis 后若旧 schedule 重算周速越界，mapper 清空整组 schedule', () => {
  const existingSafety = nutritionPlanRow().safetyInputs;
  existingSafety.targetWeightKg = 79.5;
  existingSafety.targetLossKgPerWeek = 0.5;
  existingSafety.targetDate = '2026-08-21';

  const draft = draftFromPlanForm(
    new FormData(),
    '2026-08-14',
    { weightKg: 300, weightDate: '2026-08-14' },
    { muscleGain: true, fatLoss: true },
    false,
    existingSafety,
  );

  expect(draft.safetyInputs).toMatchObject({
    ageYears: 30,
    basisWeightKg: 300,
    basisWeightDate: '2026-08-14',
    targetWeightKg: null,
    targetLossKgPerWeek: null,
    targetDate: null,
  });
});

test.each([
  ['增肌', { muscleGain: true, fatLoss: false }],
  ['减脂', { muscleGain: false, fatLoss: true }],
] as const)('flag off 的%s目标可手输体重，并保存纯记录 canonical 计划', async (label, goals) => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', '');
  const user = userEvent.setup();
  render(<NutritionPlanSetup date="2026-08-14" onSaved={() => undefined} />);
  await waitForSetup();
  await chooseGoalWithManualWeight(user, label);
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));

  const plan = await waitForSavedPlan();
  expect(plan).toMatchObject({
    goals,
    equationInputs: {
      equationBranch: 'unavailable',
      activityInputs: {
        assessmentStatus: 'not-provided',
        occupation: 'not-provided',
        trainingTypes: [],
      },
    },
    targetMode: {
      protein: 'disabled',
      energy: 'disabled',
      evaluationPolicy: 'neutral-intake-only',
      autoTargetsEnabled: false,
    },
  });
  expect(screen.getByText(NUTRITION_DISCLAIMER)).toBeInTheDocument();
});

test('flag on 且两个目标都未选时保存纯记录 canonical 分支', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  const user = userEvent.setup();
  render(<NutritionPlanSetup date="2026-08-14" onSaved={() => undefined} />);
  await waitForSetup();
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));

  const plan = await waitForSavedPlan();
  expect(plan?.goals).toEqual({ muscleGain: false, fatLoss: false });
  expect(plan?.targetMode).toEqual({
    protein: 'disabled',
    energy: 'disabled',
    evaluationPolicy: 'neutral-intake-only',
    autoTargetsEnabled: true,
    reason: 'active',
  });
  expect(plan?.safetyInputs.basisWeightKg).toBeNull();
  expect(plan?.equationInputs).toMatchObject({
    equationName: 'not-calculated',
    equationBranch: 'unavailable',
    activityInputs: { assessmentStatus: 'not-provided' },
    activityCategoryLow: null,
    activityCategoryHigh: null,
    calculatedAt: null,
  });
});

test('flag on muscle-only 无体重记录时可手输并只生成蛋白范围', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  const user = userEvent.setup();
  render(<NutritionPlanSetup date="2026-08-14" onSaved={() => undefined} />);
  await waitForSetup();
  await chooseGoalWithManualWeight(user, '增肌');
  expect(screen.getByLabelText('身高（厘米）')).not.toBeVisible();
  expect(screen.getByLabelText('活动类别下界')).not.toBeVisible();
  expect(screen.getByLabelText('目标体重（公斤）')).not.toBeVisible();
  await fillMuscleFields(user);
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));

  const plan = await waitForSavedPlan();
  expect(plan?.targetMode).toMatchObject({ protein: 'range', energy: 'disabled' });
  expect(plan?.targetRanges.proteinLowG).toBeTypeOf('number');
  expect(plan?.targetRanges.energyLowKcal).toBeNull();
  expect(plan?.safetyInputs).toMatchObject({ heightCm: null, targetWeightKg: null });
  expect(plan?.equationInputs.activityInputs.assessmentStatus).toBe('not-provided');
});

test('flag on fatloss-only 无体重记录时可手输并只生成 NASEM 热量范围', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  const user = userEvent.setup();
  render(<NutritionPlanSetup date="2026-08-14" onSaved={() => undefined} />);
  await waitForSetup();
  await chooseGoalWithManualWeight(user, '减脂');
  expect(screen.getByLabelText('蛋白质计算体重')).not.toBeVisible();
  expect(screen.getByLabelText('高体脂或肥胖')).not.toBeVisible();
  await fillFatLossFields(user);
  expect(screen.getByLabelText('推算目标日期').tagName).toBe('OUTPUT');
  expect(screen.getByLabelText('推算目标日期')).toHaveTextContent('2026-10-09');
  expect(screen.queryByLabelText('目标日期')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));

  const plan = await waitForSavedPlan();
  expect(plan?.targetMode).toMatchObject({ protein: 'disabled', energy: 'range' });
  expect(plan?.targetRanges.proteinLowG).toBeNull();
  expect(plan?.targetRanges.energyLowKcal).toBeTypeOf('number');
  expect(plan?.safetyInputs).toMatchObject({
    proteinWeightMethod: null,
    highBodyFatOrObesity: null,
  });
});

test('flag on 双目标保存两套目标、完整活动与安全字段', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  await setWeight('2026-08-14', 80);
  const user = userEvent.setup();
  render(<NutritionPlanSetup date="2026-08-14" onSaved={() => undefined} />);
  await waitForSetup();
  await user.click(screen.getByLabelText('增肌'));
  await user.click(screen.getByLabelText('减脂'));
  await user.click(await screen.findByLabelText('确认使用这条体重'));
  await fillDualFields(user);
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));

  const plan = await waitForSavedPlan();
  expect(plan?.goals).toEqual({ muscleGain: true, fatLoss: true });
  expect(plan?.targetMode).toMatchObject({ protein: 'range', energy: 'range' });
  expect(plan?.equationInputs.activityInputs).toMatchObject({
    assessmentStatus: 'complete',
    occupation: 'mixed',
    activeCommuteMinutesPerDay: 20,
    householdMinutesPerDay: 30,
    stepsPerDay: 8000,
    trainingTypes: ['resistance'],
    trainingSessionsPerWeek: 4,
    trainingMinutesPerSession: 60,
    trainingIntensity: 'moderate',
  });
  expect(plan?.targetRanges.proteinLowG).toBeTypeOf('number');
  expect(plan?.targetRanges.energyLowKcal).toBeTypeOf('number');
  expect(await listNutritionPlans()).toHaveLength(1);
});

test('历史体重的真实日期作为 basisWeightDate 保留', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', '');
  await setWeight('2026-08-10', 80);
  const user = userEvent.setup();
  render(<NutritionPlanSetup date="2026-08-14" onSaved={() => undefined} />);
  await waitForSetup();
  await user.click(screen.getByLabelText('增肌'));
  await user.click(await screen.findByLabelText('确认使用这条体重'));
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));

  expect((await waitForSavedPlan())?.safetyInputs).toMatchObject({
    basisWeightKg: 80,
    basisWeightDate: '2026-08-10',
  });
});

test.each([
  ['增肌', '17', 'protein-age-under-18'],
  ['减脂', '18', 'energy-age-under-19'],
] as const)('%s年龄边界显示 %s blocker 且不生成该维度目标', async (goal, age, blocker) => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  await setWeight('2026-08-14', 80);
  const user = userEvent.setup();
  render(<NutritionPlanSetup date="2026-08-14" onSaved={() => undefined} />);
  await waitForSetup();
  await user.click(screen.getByLabelText(goal));
  await user.click(await screen.findByLabelText('确认使用这条体重'));
  if (goal === '增肌') await fillMuscleFields(user, { age });
  else await fillFatLossFields(user, { age });
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));

  expect(await screen.findByTestId(`blocker-${blocker}`)).toBeInTheDocument();
  const plan = await waitForSavedPlan();
  if (goal === '增肌') expect(plan?.targetRanges.proteinLowG).toBeNull();
  else expect(plan?.targetRanges.energyLowKcal).toBeNull();
});

test('BMI 23.9 显示 blocker 且不泄露热量目标', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  await setWeight('2026-08-14', 73.19);
  const user = userEvent.setup();
  render(<NutritionPlanSetup date="2026-08-14" onSaved={() => undefined} />);
  await waitForSetup();
  await user.click(screen.getByLabelText('减脂'));
  await user.click(await screen.findByLabelText('确认使用这条体重'));
  await fillFatLossFields(user, { targetWeight: '68', weeklyLoss: '0.298' });
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));

  expect(await screen.findByTestId('blocker-fat-loss-bmi-ineligible')).toBeInTheDocument();
  expect((await waitForSavedPlan())?.targetRanges.energyLowKcal).toBeNull();
});

test('共享健康风险会同时阻断双目标并持久显示', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  await setWeight('2026-08-14', 80);
  const user = userEvent.setup();
  render(<NutritionPlanSetup date="2026-08-14" onSaved={() => undefined} />);
  await waitForSetup();
  await user.click(screen.getByLabelText('增肌'));
  await user.click(screen.getByLabelText('减脂'));
  await user.click(await screen.findByLabelText('确认使用这条体重'));
  await fillDualFields(user);
  await user.selectOptions(screen.getByLabelText('肾病或复杂疾病'), 'yes');
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));

  expect(await screen.findByTestId('blocker-kidney-or-complex-condition')).toBeInTheDocument();
  const plan = await waitForSavedPlan();
  expect(plan?.targetRanges.proteinLowG).toBeNull();
  expect(plan?.targetRanges.energyLowKcal).toBeNull();
});

test('existing plan 除重新确认体重外完整预填', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  render(
    <NutritionPlanSetup
      date="2026-08-14"
      existing={nutritionPlanRow()}
      onSaved={() => undefined}
    />,
  );
  await waitForSetup();

  expect(screen.getByLabelText('增肌')).toBeChecked();
  expect(screen.getByLabelText('减脂')).toBeChecked();
  expect(screen.getByLabelText('当前体重（公斤）')).toHaveValue(80);
  expect(screen.getByLabelText('确认使用这条体重')).not.toBeChecked();
  expect(screen.getByLabelText('年龄')).toHaveValue(30);
  expect(screen.getByLabelText('身高（厘米）')).toHaveValue(175);
  expect(screen.getByLabelText('方程分支')).toHaveValue('female');
  expect(screen.getByLabelText('活动类别下界')).toHaveValue('low-active');
  expect(screen.getByLabelText('活动类别上界')).toHaveValue('active');
  expect(screen.getByLabelText('职业活动')).toHaveValue('mixed');
  expect(screen.getByLabelText('主动通勤分钟/天')).toHaveValue(30);
  expect(screen.getByLabelText('家务分钟/天')).toHaveValue(30);
  expect(screen.getByLabelText('步数/天')).toHaveValue(8000);
  expect(
    Array.from((screen.getByLabelText('训练类型') as HTMLSelectElement).selectedOptions).map(
      (option) => option.value,
    ),
  ).toEqual(['resistance', 'cardio']);
  expect(screen.getByLabelText('训练次数/周')).toHaveValue(4);
  expect(screen.getByLabelText('每次训练分钟')).toHaveValue(60);
  expect(screen.getByLabelText('训练强度')).toHaveValue('moderate');
  expect(screen.getByLabelText('目标体重（公斤）')).toHaveValue(72);
  expect(screen.getByLabelText('每周减重（公斤）')).toHaveValue(0.5);
  expect(screen.getByLabelText('蛋白质计算体重')).toHaveValue('current-weight');
  expect(screen.getByLabelText('高体脂或肥胖')).toHaveValue('no');
  for (const label of SHARED_SAFETY_LABELS) {
    expect(screen.getByLabelText(label)).toHaveValue('no');
  }
  expect(screen.getByRole('button', { name: '保存健康计划' })).toBeDisabled();
});

test('历史 active 计划在当前 flag off 保存后保留 raw safety audit，derived 全部中性化', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', '');
  const existing = nutritionPlanRow();
  const user = userEvent.setup();
  render(
    <NutritionPlanSetup
      date="2026-08-14"
      existing={existing}
      onSaved={() => undefined}
    />,
  );
  await waitForSetup();
  await user.click(screen.getByLabelText('确认使用这条体重'));
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));

  const plan = await waitForSavedPlan();
  const { eligibilityBlockers: _oldBlockers, ...existingRawSafety } =
    existing.safetyInputs;
  const { eligibilityBlockers, ...savedRawSafety } = plan!.safetyInputs;
  expect(savedRawSafety).toEqual(existingRawSafety);
  expect(eligibilityBlockers).toEqual(['automatic-targets-disabled']);
  expect(plan?.equationInputs).toEqual({
    equationName: 'not-calculated',
    equationBranch: 'unavailable',
    activityInputs: {
      assessmentStatus: 'not-provided',
      occupation: 'not-provided',
      activeCommuteMinutesPerDay: null,
      householdMinutesPerDay: null,
      stepsPerDay: null,
      trainingTypes: [],
      trainingSessionsPerWeek: null,
      trainingMinutesPerSession: null,
      trainingIntensity: 'not-provided',
    },
    activityCategoryLow: null,
    activityCategoryHigh: null,
    maintenanceEnergyLowKcal: null,
    maintenanceEnergyHighKcal: null,
    calculatedAt: null,
  });
  expect(Object.values(plan!.targetRanges).every((value) => value === null)).toBe(true);
  expect(plan?.targetMode).toEqual({
    protein: 'disabled',
    energy: 'disabled',
    evaluationPolicy: 'neutral-intake-only',
    autoTargetsEnabled: false,
    reason: 'professional-review-pending',
  });
});

test('existing plan 在 DB 无体重时重新确认未改 kg 保留历史 date/kg 成对快照', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', '');
  const existing = nutritionPlanRow();
  existing.safetyInputs.basisWeightDate = '2026-08-10';
  const user = userEvent.setup();
  render(
    <NutritionPlanSetup
      date="2026-08-14"
      existing={existing}
      onSaved={() => undefined}
    />,
  );
  await waitForSetup();

  expect(screen.getByLabelText('当前体重（公斤）')).toHaveValue(80);
  await user.click(screen.getByLabelText('确认使用这条体重'));
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));

  expect((await waitForSavedPlan())?.safetyInputs).toMatchObject({
    basisWeightKg: 80,
    basisWeightDate: '2026-08-10',
  });
  expect(await getWeight('2026-08-10')).toMatchObject({ weightKg: 80 });
});

test('existing plan 一旦改 kg，重新确认就绑定当前日期', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', '');
  const existing = nutritionPlanRow();
  existing.safetyInputs.basisWeightDate = '2026-08-10';
  const user = userEvent.setup();
  render(
    <NutritionPlanSetup
      date="2026-08-14"
      existing={existing}
      onSaved={() => undefined}
    />,
  );
  await waitForSetup();

  const weight = screen.getByLabelText('当前体重（公斤）');
  await user.clear(weight);
  await user.type(weight, '81');
  await user.click(screen.getByLabelText('确认使用这条体重'));
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));

  expect((await waitForSavedPlan())?.safetyInputs).toMatchObject({
    basisWeightKg: 81,
    basisWeightDate: '2026-08-14',
  });
  expect(await getWeight('2026-08-14')).toMatchObject({ weightKg: 81 });
});

test('切换 date 会重置目标、手输体重与绑定到 date/kg 的确认', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', '');
  const user = userEvent.setup();
  const { rerender } = render(
    <NutritionPlanSetup date="2026-08-14" onSaved={() => undefined} />,
  );
  await waitForSetup();
  await chooseGoalWithManualWeight(user, '增肌');
  expect(screen.getByLabelText('确认使用这条体重')).toBeChecked();

  rerender(<NutritionPlanSetup date="2026-08-15" onSaved={() => undefined} />);
  expect(screen.getByRole('status', { name: '正在读取体重记录' })).toBeInTheDocument();
  await waitForSetup();
  expect(screen.getByLabelText('增肌')).not.toBeChecked();
  await user.click(screen.getByLabelText('增肌'));
  expect(await screen.findByLabelText('当前体重（公斤）')).toHaveValue(null);
  expect(screen.getByLabelText('确认使用这条体重')).not.toBeChecked();
});

test('同一计划内目标 off→on 保留尚未提交的共享与维度字段', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  const user = userEvent.setup();
  render(<NutritionPlanSetup date="2026-08-14" onSaved={() => undefined} />);
  await waitForSetup();
  await user.click(screen.getByLabelText('减脂'));
  await user.type(screen.getByLabelText('年龄'), '30');
  await user.type(screen.getByLabelText('身高（厘米）'), '175');
  await user.selectOptions(screen.getByLabelText('职业活动'), 'mixed');
  await user.type(screen.getByLabelText('目标体重（公斤）'), '76');

  await user.click(screen.getByLabelText('减脂'));
  await user.click(screen.getByLabelText('减脂'));

  expect(screen.getByLabelText('年龄')).toHaveValue(30);
  expect(screen.getByLabelText('身高（厘米）')).toHaveValue(175);
  expect(screen.getByLabelText('职业活动')).toHaveValue('mixed');
  expect(screen.getByLabelText('目标体重（公斤）')).toHaveValue(76);
});

test('体重候选变化会使 date/kg 确认自动失效', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', '');
  const user = userEvent.setup();
  render(<NutritionPlanSetup date="2026-08-14" onSaved={() => undefined} />);
  await waitForSetup();
  await chooseGoalWithManualWeight(user, '增肌');
  const weight = screen.getByLabelText('当前体重（公斤）');
  expect(screen.getByLabelText('确认使用这条体重')).toBeChecked();
  await user.clear(weight);
  await user.type(weight, '81');
  expect(screen.getByLabelText('确认使用这条体重')).not.toBeChecked();
  expect(screen.getByRole('button', { name: '保存健康计划' })).toBeDisabled();
});

test('useLiveQuery 未完成时只显示 loading sentinel，不闪提交表单', async () => {
  render(<NutritionPlanSetup date="2026-08-14" onSaved={() => undefined} />);
  expect(screen.getByRole('status', { name: '正在读取体重记录' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '保存健康计划' })).not.toBeInTheDocument();
  expect(await screen.findByRole('button', { name: '保存健康计划' })).toBeInTheDocument();
});

test('submit 在第一个 await 前快照 FormData、目标与体重', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', '');
  const onSaved = vi.fn();
  let releaseAtomicSave!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseAtomicSave = resolve;
  });
  const atomicSaveSpy = vi
    .spyOn(nutritionPlanRepo, 'saveNutritionPlanWithWeight')
    .mockImplementation(async (plan) => {
      await gate;
      return plan;
    });
  const user = userEvent.setup();
  render(<NutritionPlanSetup date="2026-08-14" onSaved={onSaved} />);
  await waitForSetup();
  await chooseGoalWithManualWeight(user, '增肌');
  const goal = screen.getByLabelText('增肌');
  const weight = screen.getByLabelText('当前体重（公斤）');
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));
  await waitFor(() => expect(atomicSaveSpy).toHaveBeenCalledTimes(1));

  fireEvent.click(goal);
  fireEvent.change(weight, { target: { value: '90' } });
  await act(async () => releaseAtomicSave());

  expect(atomicSaveSpy.mock.calls[0][0]).toMatchObject({
    effectiveFrom: '2026-08-14',
    goals: { muscleGain: true, fatLoss: false },
    safetyInputs: { basisWeightKg: 80, basisWeightDate: '2026-08-14' },
  });
  expect(atomicSaveSpy.mock.calls[0][1]).toEqual({ date: '2026-08-14', weightKg: 80 });
  expect(onSaved).toHaveBeenCalledTimes(1);
});

test('useRef latch 阻止双击重复 save/onSaved', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', '');
  await setWeight('2026-08-14', 80);
  const realSave = nutritionPlanRepo.saveNutritionPlan;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const saveSpy = vi
    .spyOn(nutritionPlanRepo, 'saveNutritionPlan')
    .mockImplementation(async (plan) => {
      await gate;
      return realSave(plan);
    });
  const onSaved = vi.fn();
  const user = userEvent.setup();
  render(<NutritionPlanSetup date="2026-08-14" onSaved={onSaved} />);
  await waitForSetup();
  await user.click(screen.getByLabelText('增肌'));
  await user.click(await screen.findByLabelText('确认使用这条体重'));
  const submit = screen.getByRole('button', { name: '保存健康计划' });
  await user.dblClick(submit);

  await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
  await act(async () => release());
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(saveSpy).toHaveBeenCalledTimes(1);
});

test('成功保存后 latch 保持关闭，父组件未立即卸载也不会重复 save/onSaved', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', '');
  await setWeight('2026-08-14', 80);
  const saveSpy = vi.spyOn(nutritionPlanRepo, 'saveNutritionPlan');
  const onSaved = vi.fn();
  const user = userEvent.setup();
  render(<NutritionPlanSetup date="2026-08-14" onSaved={onSaved} />);
  await waitForSetup();
  await user.click(screen.getByLabelText('增肌'));
  await user.click(await screen.findByLabelText('确认使用这条体重'));
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

  await user.click(screen.getByRole('button', { name: '保存健康计划' }));
  await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
  expect(onSaved).toHaveBeenCalledTimes(1);
});

test('异步保存错误可见，latch 释放后可重试且只回调一次', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', '');
  await setWeight('2026-08-14', 80);
  const realSave = nutritionPlanRepo.saveNutritionPlan;
  const saveSpy = vi
    .spyOn(nutritionPlanRepo, 'saveNutritionPlan')
    .mockRejectedValueOnce(new Error('保存暂时失败'))
    .mockImplementation(realSave);
  const onSaved = vi.fn();
  const user = userEvent.setup();
  render(<NutritionPlanSetup date="2026-08-14" onSaved={onSaved} />);
  await waitForSetup();
  await user.click(screen.getByLabelText('增肌'));
  await user.click(await screen.findByLabelText('确认使用这条体重'));
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('保存暂时失败');
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(saveSpy).toHaveBeenCalledTimes(2);
});

test('StrictMode effect replay 后仍能显示异步错误、重试并回调', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', '');
  await setWeight('2026-08-14', 80);
  const realSave = nutritionPlanRepo.saveNutritionPlan;
  vi.spyOn(nutritionPlanRepo, 'saveNutritionPlan')
    .mockRejectedValueOnce(new Error('严格模式保存失败'))
    .mockImplementation(realSave);
  const onSaved = vi.fn();
  const user = userEvent.setup();
  render(
    <StrictMode>
      <NutritionPlanSetup date="2026-08-14" onSaved={onSaved} />
    </StrictMode>,
  );
  await waitForSetup();
  await user.click(screen.getByLabelText('增肌'));
  await user.click(await screen.findByLabelText('确认使用这条体重'));
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('严格模式保存失败');
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
});

test('详情持久展示 blocker、体重依据、两套范围、正确来源和固定免责声明', () => {
  const plan = structuredClone(nutritionPlanRow());
  plan.safetyInputs.eligibilityBlockers = ['kidney-or-complex-condition'];
  render(<NutritionPlanDetails plan={plan} targetsEnabled onEdit={() => undefined} />);

  expect(screen.getByText('110–160 g/日')).toBeInTheDocument();
  expect(screen.getByText('2000–2150 kcal/日')).toBeInTheDocument();
  expect(screen.getByText('当前目标按 2026-08-14 的 80.0 kg 估算')).toBeInTheDocument();
  expect(screen.getByText('ISSN · JISSN-2017-14-20')).toBeInTheDocument();
  expect(screen.getByText('NASEM 2023 成人 EER')).toBeInTheDocument();
  expect(screen.getByTestId('blocker-kidney-or-complex-condition')).toBeInTheDocument();
  expect(screen.getByText(NUTRITION_DISCLAIMER)).toBeInTheDocument();
  expect(screen.getByText('WS/T 428—2013')).toBeInTheDocument();
});

test('current kill switch 关闭时历史 active plan 详情降级为纯记录且隐藏依据与范围', () => {
  render(
    <NutritionPlanDetails
      plan={nutritionPlanRow()}
      targetsEnabled={false}
      onEdit={() => undefined}
    />,
  );

  expect(screen.getByText('当前状态：仅记录饮食')).toBeInTheDocument();
  expect(screen.queryByText(/蛋白质建议：/)).not.toBeInTheDocument();
  expect(screen.queryByText(/热量建议：/)).not.toBeInTheDocument();
  expect(screen.queryByText(/当前目标按/)).not.toBeInTheDocument();
  expect(screen.queryByText(/ISSN/)).not.toBeInTheDocument();
  expect(screen.queryByText(/NASEM/)).not.toBeInTheDocument();
  expect(screen.getByText(NUTRITION_DISCLAIMER)).toBeInTheDocument();
});
