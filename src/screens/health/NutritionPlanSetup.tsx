import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../../components/Button';
import { addDays } from '../../lib/dates';
import { autoNutritionTargetsEnabled } from '../../lib/nutritionFeatureFlags';
import { buildNutritionPlan, type NutritionPlanDraft } from '../../lib/nutritionPlan';
import { impliedWeeklyLossKg } from '../../lib/nutritionPlanPolicy';
import type {
  ActivityCategory,
  NutritionActivityInputs,
  NutritionEligibilityBlocker,
  NutritionGoals,
  NutritionPlan,
  NutritionSafetyInputs,
  TrainingType,
} from '../../lib/nutritionTypes';
import {
  saveNutritionPlan,
  saveNutritionPlanWithWeight,
} from '../../repos/nutritionPlanRepo';
import { getLatestWeightOnOrBefore } from '../../repos/weightRepo';

export interface NutritionPlanSetupProps {
  date: string;
  existing?: NutritionPlan;
  onSaved(): void;
}

export interface BasisWeightSnapshot {
  weightKg: number | null;
  weightDate: string | null;
}

export interface DerivedTargetSchedule {
  targetDate: string;
  targetLossKgPerWeek: number;
}

const ACTIVITY_CATEGORIES = [
  'inactive',
  'low-active',
  'active',
  'very-active',
] as const satisfies readonly ActivityCategory[];
const ACTIVITY_LABELS: Record<ActivityCategory, string> = {
  inactive: '不活跃',
  'low-active': '低活动',
  active: '活跃',
  'very-active': '高度活跃',
};
const EQUATION_BRANCHES = ['female', 'male'] as const;
const OCCUPATIONS = [
  'mostly-seated',
  'mixed',
  'mostly-standing',
  'manual-labor',
] as const;
const TRAINING_TYPES = [
  'resistance',
  'cardio',
  'sport',
  'mobility',
  'mixed',
  'none',
] as const satisfies readonly TrainingType[];
const TRAINING_INTENSITIES = ['light', 'moderate', 'vigorous', 'mixed'] as const;
const PROTEIN_WEIGHT_METHODS = [
  'current-weight',
  'professional-reference-weight',
  'unverified',
] as const;
const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

const EMPTY_ACTIVITY = (): NutritionActivityInputs => ({
  assessmentStatus: 'not-provided',
  occupation: 'not-provided',
  activeCommuteMinutesPerDay: null,
  householdMinutesPerDay: null,
  stepsPerDay: null,
  trainingTypes: [],
  trainingSessionsPerWeek: null,
  trainingMinutesPerSession: null,
  trainingIntensity: 'not-provided',
});

function scalarValue(form: FormData, name: string, allowEmpty = false): string {
  const values = form.getAll(name);
  if (values.length !== 1 || typeof values[0] !== 'string') {
    throw new Error(`${name} 必须且只能提供一个值`);
  }
  const value = values[0].trim();
  if (!allowEmpty && value === '') {
    throw new Error(`${name} 必须提供`);
  }
  return value;
}

function textValue(form: FormData, name: string): string {
  return scalarValue(form, name);
}

function finiteNumber(
  form: FormData,
  name: string,
  rules: { min?: number; max?: number; integer?: boolean } = {},
): number {
  const raw = textValue(form, name);
  if (!DECIMAL_NUMBER.test(raw)) throw new Error(`${name} 必须是十进制有限数`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} 必须是有限数`);
  if (rules.integer && !Number.isInteger(value)) throw new Error(`${name} 必须是整数`);
  if (rules.min !== undefined && value < rules.min) {
    throw new Error(`${name} 不得小于 ${rules.min}`);
  }
  if (rules.max !== undefined && value > rules.max) {
    throw new Error(`${name} 不得大于 ${rules.max}`);
  }
  return value;
}

function enumValue<const T extends string>(
  form: FormData,
  name: string,
  allowed: readonly T[],
): T {
  const value = textValue(form, name);
  if (!allowed.includes(value as T)) throw new Error(`${name} 不是允许的选项`);
  return value as T;
}

function optionalEnumValue<const T extends string>(
  form: FormData,
  name: string,
  allowed: readonly T[],
): T | null {
  const value = scalarValue(form, name, true);
  if (value === '') return null;
  if (!allowed.includes(value as T)) {
    throw new Error(`${name} 不是允许的选项`);
  }
  return value as T;
}

function yesNoValue(form: FormData, name: string): boolean {
  const value = textValue(form, name);
  if (value !== 'yes' && value !== 'no') throw new Error(`${name} 必须选择是或否`);
  return value === 'yes';
}

function trainingValues(form: FormData): TrainingType[] {
  const values = form.getAll('trainingType');
  if (values.length === 0 || values.some((value) => typeof value !== 'string')) {
    throw new Error('trainingType 必须至少选择一项');
  }
  const parsed = values.map((value) => {
    if (!TRAINING_TYPES.includes(value as TrainingType)) {
      throw new Error('trainingType 不是允许的选项');
    }
    return value as TrainingType;
  });
  if (new Set(parsed).size !== parsed.length) throw new Error('训练类型不能重复');
  if (parsed.includes('none') && parsed.length !== 1) {
    throw new Error('无训练不能与其他训练类型同时选择');
  }
  return parsed;
}

function assertAdjacentActivityRange(
  low: ActivityCategory,
  high: ActivityCategory | null,
): void {
  if (high === null) return;
  const lowIndex = ACTIVITY_CATEGORIES.indexOf(low);
  const highIndex = ACTIVITY_CATEGORIES.indexOf(high);
  if (highIndex !== lowIndex + 1) throw new Error('活动类别上界必须与下界相邻且升序');
}

export function deriveTargetSchedule(
  basisWeightKg: number,
  targetWeightKg: number,
  basisDate: string,
  targetLossKgPerWeek: number,
): DerivedTargetSchedule {
  if (
    ![basisWeightKg, targetWeightKg, targetLossKgPerWeek].every(Number.isFinite) ||
    targetLossKgPerWeek <= 0
  ) {
    throw new Error('每周减重必须是大于 0 的有限数');
  }
  if (targetWeightKg >= basisWeightKg) throw new Error('目标体重必须低于计算体重');
  const exactDays = ((basisWeightKg - targetWeightKg) * 7) / targetLossKgPerWeek;
  const candidates = [...new Set([Math.floor(exactDays), Math.round(exactDays), Math.ceil(exactDays)])]
    .filter((days) => days >= 1)
    .map((days) => {
      const targetDate = addDays(basisDate, days);
      const implied = impliedWeeklyLossKg(basisWeightKg, targetWeightKg, basisDate, targetDate);
      return { targetDate, difference: Math.abs(implied - targetLossKgPerWeek) };
    })
    .sort((left, right) =>
      left.difference - right.difference || left.targetDate.localeCompare(right.targetDate),
    );
  const best = candidates[0];
  if (!best || best.difference > 0.0005) {
    throw new Error('该每周速度无法按整天推算，请以 0.001 kg/周为单位调整');
  }
  return { targetDate: best.targetDate, targetLossKgPerWeek };
}

function emptySafety(weight: BasisWeightSnapshot): Omit<NutritionSafetyInputs, 'eligibilityBlockers'> {
  return {
    basisWeightKg: weight.weightKg,
    basisWeightDate: weight.weightDate,
    proteinWeightMethod: null,
    ageYears: null,
    heightCm: null,
    targetWeightKg: null,
    targetLossKgPerWeek: null,
    targetDate: null,
    highBodyFatOrObesity: null,
    pregnantOrBreastfeeding: null,
    requiresTherapeuticDiet: null,
    kidneyDiseaseOrComplexCondition: null,
    eatingDisorderOrRedsRisk: null,
    athleteOrExtremeActivity: null,
    eligibilityStandard: 'WS/T 428—2013',
  };
}

function safetyAuditSnapshot(
  existing: NutritionSafetyInputs,
  date: string,
  weight: BasisWeightSnapshot,
): Omit<NutritionSafetyInputs, 'eligibilityBlockers'> {
  const { eligibilityBlockers: _ignored, ...raw } = existing;
  const safety = {
    ...raw,
    basisWeightKg: weight.weightKg ?? raw.basisWeightKg,
    basisWeightDate: weight.weightDate ?? raw.basisWeightDate,
  };
  const scheduleInvalid =
    (safety.targetDate !== null && safety.targetDate <= date) ||
    (safety.targetDate !== null &&
      safety.basisWeightDate !== null &&
      safety.targetDate <= safety.basisWeightDate) ||
    (safety.targetWeightKg !== null &&
      safety.basisWeightKg !== null &&
      safety.targetWeightKg >= safety.basisWeightKg);
  if (scheduleInvalid) {
    safety.targetWeightKg = null;
    safety.targetLossKgPerWeek = null;
    safety.targetDate = null;
  } else if (
    safety.basisWeightKg !== null &&
    safety.basisWeightDate !== null &&
    safety.targetWeightKg !== null &&
    safety.targetLossKgPerWeek !== null &&
    safety.targetDate !== null
  ) {
    const impliedLoss = impliedWeeklyLossKg(
      safety.basisWeightKg,
      safety.targetWeightKg,
      safety.basisWeightDate,
      safety.targetDate,
    );
    if (impliedLoss < 0.001 || impliedLoss > 20) {
      safety.targetWeightKg = null;
      safety.targetLossKgPerWeek = null;
      safety.targetDate = null;
    } else {
      safety.targetLossKgPerWeek = impliedLoss;
    }
  }
  return safety;
}

export function draftFromPlanForm(
  form: FormData,
  date: string,
  weight: BasisWeightSnapshot,
  goals: NutritionGoals,
  auto: boolean,
  existingSafety?: NutritionSafetyInputs,
): NutritionPlanDraft {
  const safety =
    !auto && existingSafety
      ? safetyAuditSnapshot(existingSafety, date, weight)
      : emptySafety(weight);
  const emptyEquation: NutritionPlanDraft['equationInputs'] = {
    equationBranch: 'unavailable',
    activityCategoryLow: null,
    activityCategoryHigh: null,
    activityInputs: EMPTY_ACTIVITY(),
  };
  if (!auto || (!goals.muscleGain && !goals.fatLoss)) {
    return { effectiveFrom: date, goals, safetyInputs: safety, equationInputs: emptyEquation };
  }
  if (weight.weightKg === null || weight.weightDate === null) {
    throw new Error('自动目标需要已确认的计算体重与日期');
  }

  safety.ageYears = finiteNumber(form, 'ageYears', { min: 1, max: 120, integer: true });
  safety.pregnantOrBreastfeeding = yesNoValue(form, 'pregnantOrBreastfeeding');
  safety.requiresTherapeuticDiet = yesNoValue(form, 'requiresTherapeuticDiet');
  safety.kidneyDiseaseOrComplexCondition = yesNoValue(
    form,
    'kidneyDiseaseOrComplexCondition',
  );
  safety.eatingDisorderOrRedsRisk = yesNoValue(form, 'eatingDisorderOrRedsRisk');
  safety.athleteOrExtremeActivity = yesNoValue(form, 'athleteOrExtremeActivity');

  if (goals.muscleGain) {
    safety.proteinWeightMethod = enumValue(
      form,
      'proteinWeightMethod',
      PROTEIN_WEIGHT_METHODS,
    );
    safety.highBodyFatOrObesity = yesNoValue(form, 'highBodyFatOrObesity');
  }

  if (!goals.fatLoss) {
    return { effectiveFrom: date, goals, safetyInputs: safety, equationInputs: emptyEquation };
  }

  safety.heightCm = finiteNumber(form, 'heightCm', { min: 100, max: 250 });
  safety.targetWeightKg = finiteNumber(form, 'targetWeightKg', { min: 20, max: 300 });
  const schedule = deriveTargetSchedule(
    weight.weightKg,
    safety.targetWeightKg,
    weight.weightDate,
    finiteNumber(form, 'targetLossKgPerWeek', { min: 0.001, max: 20 }),
  );
  if (schedule.targetDate <= date) {
    throw new Error('推算目标日期必须晚于计划日期');
  }
  safety.targetLossKgPerWeek = schedule.targetLossKgPerWeek;
  safety.targetDate = schedule.targetDate;

  const activityCategoryLow = enumValue(
    form,
    'activityCategoryLow',
    ACTIVITY_CATEGORIES,
  );
  const activityCategoryHigh = optionalEnumValue(
    form,
    'activityCategoryHigh',
    ACTIVITY_CATEGORIES,
  );
  assertAdjacentActivityRange(activityCategoryLow, activityCategoryHigh);
  const selectedTraining = trainingValues(form);
  const noTraining = selectedTraining[0] === 'none';
  const activityInputs: NutritionActivityInputs = {
    assessmentStatus: 'complete',
    occupation: enumValue(form, 'occupation', OCCUPATIONS),
    activeCommuteMinutesPerDay: finiteNumber(form, 'activeCommuteMinutesPerDay', {
      min: 0,
      max: 1440,
    }),
    householdMinutesPerDay: finiteNumber(form, 'householdMinutesPerDay', {
      min: 0,
      max: 1440,
    }),
    stepsPerDay: finiteNumber(form, 'stepsPerDay', { min: 0, max: 100000 }),
    trainingTypes: selectedTraining,
    trainingSessionsPerWeek: noTraining
      ? 0
      : finiteNumber(form, 'trainingSessionsPerWeek', { min: 0, max: 14 }),
    trainingMinutesPerSession: noTraining
      ? 0
      : finiteNumber(form, 'trainingMinutesPerSession', { min: 0, max: 600 }),
    trainingIntensity: noTraining
      ? 'none'
      : enumValue(form, 'trainingIntensity', TRAINING_INTENSITIES),
  };
  return {
    effectiveFrom: date,
    goals,
    safetyInputs: safety,
    equationInputs: {
      equationBranch: enumValue(form, 'equationBranch', EQUATION_BRANCHES),
      activityCategoryLow,
      activityCategoryHigh,
      activityInputs,
    },
  };
}

export const NUTRITION_DISCLAIMER =
  '自动估算仅作饮食记录参考，不构成医疗诊断或治疗建议，也不保证达到增肌或减脂结果。';

export const NUTRITION_BLOCKER_COPY: Record<NutritionEligibilityBlocker, string> = {
  'automatic-targets-disabled': '自动目标尚未开放，当前仅记录摄入',
  'protein-age-under-18': '18 岁以下暂不自动估算蛋白质目标',
  'energy-age-under-19': '19 岁以下暂不自动估算热量目标',
  'missing-inputs': '资料不完整，暂不自动计算',
  'equation-branch-unavailable': '计算分支未确认，暂不估算热量',
  'fat-loss-bmi-ineligible': '当前 BMI 不在首阶段自动热量估算范围',
  'target-bmi-below-18.5': '目标体重低于安全边界，暂不估算热量',
  'speed-or-six-month-limit': '请把目标拆为不超过初始体重 10% 的首阶段',
  'protein-weight-method-unverified': '请先确认蛋白质计算所用体重',
  'pregnancy-or-breastfeeding': '孕期或哺乳期需由专业人员评估',
  'therapeutic-diet-required': '治疗性饮食需由专业人员评估',
  'kidney-or-complex-condition': '复杂健康情况需由专业人员评估',
  'eating-disorder-or-reds-risk': '进食障碍或 RED-S 风险需由专业人员评估',
  'athlete-or-extreme-activity': '运动员或极高活动量需个体化评估',
  'energy-floor': '估算热量低于当前安全下限，暂不生成目标',
};

function rangeText(low: number | null, high: number | null, unit: string): string {
  if (low === null || high === null) return '暂不自动估算';
  return low === high
    ? `${Math.round(low)} ${unit}/日`
    : `${Math.round(low)}–${Math.round(high)} ${unit}/日`;
}

export interface NutritionPlanDetailsProps {
  plan: NutritionPlan;
  targetsEnabled: boolean;
  onEdit(): void;
}

function BlockerList({ blockers }: { blockers: readonly NutritionEligibilityBlocker[] }) {
  if (blockers.length === 0) return null;
  return (
    <ul aria-label="计划限制" className="mt-4 space-y-2 text-xs leading-5 text-mute">
      {blockers.map((code) => (
        <li data-testid={`blocker-${code}`} key={code}>
          {NUTRITION_BLOCKER_COPY[code]}
        </li>
      ))}
    </ul>
  );
}

export function NutritionPlanDetails({
  plan,
  targetsEnabled,
  onEdit,
}: NutritionPlanDetailsProps) {
  if (!targetsEnabled) {
    return (
      <section aria-label="当前健康计划" className="forged-surface rounded-2xl p-5">
        <p className="text-sm font-semibold text-ink">当前状态：仅记录饮食</p>
        <p className="mt-2 text-xs text-mute">自动目标评价未开启</p>
        <div className="etch" />
        <p className="text-xs leading-5 text-mute">{NUTRITION_DISCLAIMER}</p>
        <Button variant="secondary" className="mt-4" onClick={onEdit}>
          调整目标
        </Button>
      </section>
    );
  }

  const goalText = [
    plan.goals.muscleGain ? '增肌' : '',
    plan.goals.fatLoss ? '减脂' : '',
  ]
    .filter(Boolean)
    .join(' · ') || '仅记录';
  const basis =
    plan.safetyInputs.basisWeightKg === null || plan.safetyInputs.basisWeightDate === null
      ? '当前目标未绑定计算体重'
      : `当前目标按 ${plan.safetyInputs.basisWeightDate} 的 ${plan.safetyInputs.basisWeightKg.toFixed(1)} kg 估算`;
  const energySource =
    plan.equationInputs.equationName === 'NASEM-2023-adult-EER'
      ? 'NASEM 2023 成人 EER'
      : '未计算';

  return (
    <section aria-label="当前健康计划" className="forged-surface rounded-2xl p-5">
      <p className="text-sm font-semibold text-ink">目标：{goalText}</p>
      <div className="etch" />
      <dl className="grid gap-3 text-sm leading-6 text-mute">
        <div>
          <dt className="inline font-semibold text-ink">蛋白质建议：</dt>
          <dd className="inline">
            {rangeText(plan.targetRanges.proteinLowG, plan.targetRanges.proteinHighG, 'g')}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold text-ink">热量建议：</dt>
          <dd className="inline">
            {rangeText(plan.targetRanges.energyLowKcal, plan.targetRanges.energyHighKcal, 'kcal')}
          </dd>
        </div>
        <div>
          <dt className="sr-only">计算依据：</dt>
          <dd>{basis}</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-ink">蛋白质来源：</dt>
          <dd className="inline">
            {plan.proteinPolicySource} · {plan.proteinPolicyVersion}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold text-ink">热量来源：</dt>
          <dd className="inline">{energySource}</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-ink">BMI 与首阶段资格标准：</dt>
          <dd className="inline">{plan.safetyInputs.eligibilityStandard}</dd>
        </div>
        {plan.goals.fatLoss &&
          plan.safetyInputs.targetWeightKg !== null &&
          plan.safetyInputs.targetLossKgPerWeek !== null &&
          plan.safetyInputs.targetDate !== null && (
            <div>
              <dt className="inline font-semibold text-ink">减脂节奏：</dt>
              <dd className="inline">
                目标 {plan.safetyInputs.targetWeightKg.toFixed(1)} kg ·{' '}
                {plan.safetyInputs.targetLossKgPerWeek.toFixed(3)} kg/周 · 推算至{' '}
                {plan.safetyInputs.targetDate}
              </dd>
            </div>
          )}
      </dl>
      <BlockerList blockers={plan.safetyInputs.eligibilityBlockers} />
      <p className="mt-4 text-xs leading-5 text-mute">{NUTRITION_DISCLAIMER}</p>
      <Button variant="secondary" className="mt-4" onClick={onEdit}>
        调整目标
      </Button>
    </section>
  );
}

const CONTROL_CLASS =
  'min-h-11 w-full rounded-xl border border-line bg-raised px-3 text-ink outline-none focus-visible:ring-2 focus-visible:ring-iron focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

function Field({
  label,
  ...props
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="grid gap-1.5 text-xs text-mute">
      {label}
      <input {...props} aria-label={label} className={CONTROL_CLASS} />
    </label>
  );
}

function Select({
  label,
  children,
  ...props
}: { label: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="grid gap-1.5 text-xs text-mute">
      {label}
      <select {...props} aria-label={label} className={CONTROL_CLASS}>
        {children}
      </select>
    </label>
  );
}

function YesNo({
  label,
  name,
  value,
}: {
  label: string;
  name: string;
  value: boolean | null | undefined;
}) {
  return (
    <Select label={label} name={name} defaultValue={value === true ? 'yes' : value === false ? 'no' : ''} required>
      <option value="">请选择</option>
      <option value="no">否</option>
      <option value="yes">是</option>
    </Select>
  );
}

function SectionLegend({ children }: { children: string }) {
  return <legend className="mb-3 text-xs font-semibold tracking-[1.5px] text-amber">{children}</legend>;
}

const WEIGHT_LOADING = Symbol('weight-loading');

function weightKey(date: string, kg: number): string {
  return JSON.stringify({ date, kg });
}

function candidateNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function NutritionPlanSetupState({ date, existing, onSaved }: NutritionPlanSetupProps) {
  const auto = autoNutritionTargetsEnabled();
  const latest = useLiveQuery(
    () => getLatestWeightOnOrBefore(date),
    [date],
    WEIGHT_LOADING,
  );
  const [muscleGain, setMuscleGain] = useState(existing?.goals.muscleGain ?? false);
  const [fatLoss, setFatLoss] = useState(existing?.goals.fatLoss ?? false);
  const [manualWeight, setManualWeight] = useState(
    existing?.safetyInputs.basisWeightKg?.toString() ?? '',
  );
  const [manualWeightEdited, setManualWeightEdited] = useState(false);
  const [targetWeight, setTargetWeight] = useState(
    existing?.safetyInputs.targetWeightKg?.toString() ?? '',
  );
  const [weeklyLoss, setWeeklyLoss] = useState(
    existing?.safetyInputs.targetLossKgPerWeek?.toString() ?? '',
  );
  const [activityLow, setActivityLow] = useState<ActivityCategory | ''>(
    existing?.equationInputs.activityCategoryLow ?? '',
  );
  const [activityHigh, setActivityHigh] = useState<ActivityCategory | ''>(
    existing?.equationInputs.activityCategoryHigh ?? '',
  );
  const [selectedTraining, setSelectedTraining] = useState<TrainingType[]>(
    existing?.equationInputs.activityInputs.trainingTypes ?? [],
  );
  const [trainingIntensity, setTrainingIntensity] = useState<
    (typeof TRAINING_INTENSITIES)[number] | ''
  >(() => {
    const value = existing?.equationInputs.activityInputs.trainingIntensity;
    return TRAINING_INTENSITIES.includes(value as (typeof TRAINING_INTENSITIES)[number])
      ? (value as (typeof TRAINING_INTENSITIES)[number])
      : '';
  });
  const [confirmedWeightKey, setConfirmedWeightKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState('');
  const [blockers, setBlockers] = useState<NutritionEligibilityBlocker[]>(
    existing?.safetyInputs.eligibilityBlockers ?? [],
  );
  const submitLatch = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (latest === WEIGHT_LOADING) {
    return (
      <section
        role="status"
        aria-label="正在读取体重记录"
        className="forged-surface min-h-40 animate-pulse rounded-2xl p-5 motion-reduce:animate-none"
      >
        <span className="sr-only">正在读取体重记录</span>
      </section>
    );
  }

  const hasGoal = muscleGain || fatLoss;
  const manualCandidate = candidateNumber(manualWeight);
  const candidateWeight = latest?.weightKg ?? manualCandidate;
  const unchangedExistingWeightDate =
    !manualWeightEdited &&
    manualCandidate !== null &&
    manualCandidate === existing?.safetyInputs.basisWeightKg
      ? existing.safetyInputs.basisWeightDate
      : null;
  const candidateDate = latest?.date ?? unchangedExistingWeightDate ?? date;
  const validWeight =
    !hasGoal ||
    (candidateWeight !== null && candidateWeight >= 20 && candidateWeight <= 300);
  const currentWeightKey =
    hasGoal && candidateWeight !== null ? weightKey(candidateDate, candidateWeight) : null;
  const weightConfirmed =
    currentWeightKey !== null && confirmedWeightKey === currentWeightKey;

  let targetDatePreview = '';
  let targetDateError = '';
  if (
    fatLoss &&
    candidateWeight !== null &&
    targetWeight.trim() !== '' &&
    weeklyLoss.trim() !== ''
  ) {
    try {
      const schedule = deriveTargetSchedule(
        candidateWeight,
        Number(targetWeight),
        candidateDate,
        Number(weeklyLoss),
      );
      if (schedule.targetDate <= date) {
        throw new Error('推算目标日期必须晚于计划日期');
      }
      targetDatePreview = schedule.targetDate;
    } catch (cause) {
      targetDateError = cause instanceof Error ? cause.message : '无法推算目标日期';
    }
  }

  const existingActivity = existing?.equationInputs.activityInputs;
  const adjacentHigh =
    activityLow === ''
      ? null
      : ACTIVITY_CATEGORIES[ACTIVITY_CATEGORIES.indexOf(activityLow) + 1] ?? null;
  const noTraining = selectedTraining.includes('none');

  function changeActivityLow(next: ActivityCategory | '') {
    setActivityLow(next);
    if (next === '') {
      setActivityHigh('');
      return;
    }
    const nextHigh = ACTIVITY_CATEGORIES[ACTIVITY_CATEGORIES.indexOf(next) + 1];
    if (activityHigh !== '' && activityHigh !== nextHigh) setActivityHigh('');
  }

  function changeTraining(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = Array.from(event.currentTarget.selectedOptions).map(
      (option) => option.value as TrainingType,
    );
    const hadNone = selectedTraining.includes('none');
    if (!hadNone && next.includes('none')) {
      setSelectedTraining(['none']);
    } else if (hadNone && next.some((type) => type !== 'none')) {
      setSelectedTraining(next.filter((type) => type !== 'none'));
    } else {
      setSelectedTraining(next);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLatch.current) return;
    submitLatch.current = true;
    let persisted = false;
    try {
      const formSnapshot = new FormData(event.currentTarget);
      const dateSnapshot = date;
      const goalsSnapshot = { muscleGain, fatLoss };
      const autoSnapshot = auto;
      const latestSnapshot = latest;
      const candidateSnapshot = candidateWeight;
      const candidateDateSnapshot = candidateDate;
      const candidateKeySnapshot = currentWeightKey;
      const confirmedKeySnapshot = confirmedWeightKey;
      const onSavedSnapshot = onSaved;
      const nowSnapshot = Math.max(Date.now(), (existing?.updatedAt ?? -1) + 1);

      if (
        (goalsSnapshot.muscleGain || goalsSnapshot.fatLoss) &&
        (candidateSnapshot === null ||
          candidateSnapshot < 20 ||
          candidateSnapshot > 300 ||
          candidateKeySnapshot === null ||
          confirmedKeySnapshot !== candidateKeySnapshot)
      ) {
        throw new Error('请确认 20–300 公斤的体重');
      }
      const weightSnapshot: BasisWeightSnapshot =
        goalsSnapshot.muscleGain || goalsSnapshot.fatLoss
          ? { weightKg: candidateSnapshot, weightDate: candidateDateSnapshot }
          : { weightKg: null, weightDate: null };
      const draft = draftFromPlanForm(
        formSnapshot,
        dateSnapshot,
        weightSnapshot,
        goalsSnapshot,
        autoSnapshot,
        existing?.safetyInputs,
      );
      const plan = buildNutritionPlan(draft, {
        autoTargetsEnabled: autoSnapshot,
        now: nowSnapshot,
      });

      if (mounted.current) {
        setSaving(true);
        setError('');
      }
      if (
        (goalsSnapshot.muscleGain || goalsSnapshot.fatLoss) &&
        latestSnapshot === undefined
      ) {
        await saveNutritionPlanWithWeight(plan, {
          date: candidateDateSnapshot,
          weightKg: candidateSnapshot!,
        });
      } else {
        await saveNutritionPlan(plan);
      }
      persisted = true;
      if (mounted.current) {
        setBlockers(plan.safetyInputs.eligibilityBlockers);
        setCompleted(true);
        onSavedSnapshot();
      }
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : '保存失败，请重试');
      }
    } finally {
      if (!persisted) submitLatch.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <section aria-labelledby="nutrition-plan-title" className="forged-surface rounded-2xl p-5">
      <p className="text-[10px] font-semibold tracking-[2px] text-amber">HEALTH PLAN</p>
      <h2 id="nutrition-plan-title" className="mt-2 text-lg font-extrabold text-ink">
        健康计划
      </h2>
      {!auto && <p className="mt-2 text-sm text-mute">自动目标尚未开放，仍可记录饮食</p>}
      <div className="etch" />
      <form className="space-y-5" onSubmit={submit}>
        <fieldset>
          <SectionLegend>选择目标</SectionLegend>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3 text-sm text-ink outline-none focus-within:ring-2 focus-within:ring-iron">
              <input
                aria-label="增肌"
                type="checkbox"
                checked={muscleGain}
                onChange={(event) => setMuscleGain(event.target.checked)}
              />
              增肌
            </label>
            <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3 text-sm text-ink outline-none focus-within:ring-2 focus-within:ring-iron">
              <input
                aria-label="减脂"
                type="checkbox"
                checked={fatLoss}
                onChange={(event) => setFatLoss(event.target.checked)}
              />
              减脂
            </label>
          </div>
        </fieldset>

        {hasGoal && (
          <fieldset>
            <SectionLegend>计算体重</SectionLegend>
            {!latest && (
              <Field
                label="当前体重（公斤）"
                type="number"
                min="20"
                max="300"
                step="0.1"
                value={manualWeight}
                onChange={(event) => {
                  setManualWeightEdited(true);
                  setManualWeight(event.target.value);
                }}
                required
              />
            )}
            <label className="mt-3 flex min-h-11 items-center gap-3 rounded-xl border border-line px-3 text-sm text-ink outline-none focus-within:ring-2 focus-within:ring-iron">
              <input
                aria-label="确认使用这条体重"
                type="checkbox"
                checked={weightConfirmed}
                onChange={(event) =>
                  setConfirmedWeightKey(
                    event.target.checked && currentWeightKey !== null ? currentWeightKey : null,
                  )
                }
              />
              确认使用{' '}
              {latest
                ? `${latest.date} 的 ${latest.weightKg.toFixed(1)} kg`
                : '这条体重'}
            </label>
          </fieldset>
        )}

        {auto && (
          <>
            <fieldset className="grid gap-3" hidden={!hasGoal} disabled={!hasGoal}>
              <SectionLegend>基础与共享安全</SectionLegend>
              <Field
                label="年龄"
                name="ageYears"
                type="number"
                min="1"
                max="120"
                step="1"
                defaultValue={existing?.safetyInputs.ageYears ?? ''}
                required
              />
              <YesNo
                label="孕期或哺乳期"
                name="pregnantOrBreastfeeding"
                value={existing?.safetyInputs.pregnantOrBreastfeeding}
              />
              <YesNo
                label="需治疗性饮食"
                name="requiresTherapeuticDiet"
                value={existing?.safetyInputs.requiresTherapeuticDiet}
              />
              <YesNo
                label="肾病或复杂疾病"
                name="kidneyDiseaseOrComplexCondition"
                value={existing?.safetyInputs.kidneyDiseaseOrComplexCondition}
              />
              <YesNo
                label="进食障碍或 RED-S 风险"
                name="eatingDisorderOrRedsRisk"
                value={existing?.safetyInputs.eatingDisorderOrRedsRisk}
              />
              <YesNo
                label="运动员或极高活动量"
                name="athleteOrExtremeActivity"
                value={existing?.safetyInputs.athleteOrExtremeActivity}
              />
            </fieldset>

            <fieldset className="grid gap-3" hidden={!muscleGain} disabled={!muscleGain}>
                <SectionLegend>蛋白质估算</SectionLegend>
                <Select
                  label="蛋白质计算体重"
                  name="proteinWeightMethod"
                  defaultValue={existing?.safetyInputs.proteinWeightMethod ?? ''}
                  required
                >
                  <option value="">请选择</option>
                  <option value="current-weight">当前体重</option>
                  <option value="professional-reference-weight">专业人员给定参考体重</option>
                  <option value="unverified">尚未确认</option>
                </Select>
                <YesNo
                  label="高体脂或肥胖"
                  name="highBodyFatOrObesity"
                  value={existing?.safetyInputs.highBodyFatOrObesity}
                />
            </fieldset>

            <fieldset className="grid gap-3" hidden={!fatLoss} disabled={!fatLoss}>
                <SectionLegend>减脂活动与节奏</SectionLegend>
                <Field
                  label="身高（厘米）"
                  name="heightCm"
                  type="number"
                  min="100"
                  max="250"
                  step="0.1"
                  defaultValue={existing?.safetyInputs.heightCm ?? ''}
                  required
                />
                <Select
                  label="方程分支"
                  name="equationBranch"
                  defaultValue={
                    existing?.equationInputs.equationBranch === 'unavailable'
                      ? ''
                      : existing?.equationInputs.equationBranch ?? ''
                  }
                  required
                >
                  <option value="">请选择</option>
                  <option value="female">女性方程</option>
                  <option value="male">男性方程</option>
                </Select>
                <Select
                  label="活动类别下界"
                  name="activityCategoryLow"
                  value={activityLow}
                  onChange={(event) =>
                    changeActivityLow(event.target.value as ActivityCategory | '')
                  }
                  required
                >
                  <option value="">请选择</option>
                  {ACTIVITY_CATEGORIES.map((category) => (
                    <option value={category} key={category}>
                      {ACTIVITY_LABELS[category]}
                    </option>
                  ))}
                </Select>
                <Select
                  label="活动类别上界"
                  name="activityCategoryHigh"
                  value={activityHigh}
                  onChange={(event) =>
                    setActivityHigh(event.target.value as ActivityCategory | '')
                  }
                >
                  <option value="">单点</option>
                  {adjacentHigh && (
                    <option value={adjacentHigh}>{ACTIVITY_LABELS[adjacentHigh]}</option>
                  )}
                </Select>
                <Select
                  label="职业活动"
                  name="occupation"
                  defaultValue={
                    existingActivity?.occupation === 'not-provided'
                      ? ''
                      : existingActivity?.occupation ?? ''
                  }
                  required
                >
                  <option value="">请选择</option>
                  <option value="mostly-seated">久坐</option>
                  <option value="mixed">混合</option>
                  <option value="mostly-standing">久站</option>
                  <option value="manual-labor">体力劳动</option>
                </Select>
                <Field
                  label="主动通勤分钟/天"
                  name="activeCommuteMinutesPerDay"
                  type="number"
                  min="0"
                  max="1440"
                  defaultValue={existingActivity?.activeCommuteMinutesPerDay ?? ''}
                  required
                />
                <Field
                  label="家务分钟/天"
                  name="householdMinutesPerDay"
                  type="number"
                  min="0"
                  max="1440"
                  defaultValue={existingActivity?.householdMinutesPerDay ?? ''}
                  required
                />
                <Field
                  label="步数/天"
                  name="stepsPerDay"
                  type="number"
                  min="0"
                  max="100000"
                  defaultValue={existingActivity?.stepsPerDay ?? ''}
                  required
                />
                <Select
                  label="训练类型"
                  name="trainingType"
                  multiple
                  size={6}
                  value={selectedTraining}
                  onChange={changeTraining}
                  required
                >
                  <option value="resistance">抗阻</option>
                  <option value="cardio">有氧</option>
                  <option value="sport">运动</option>
                  <option value="mobility">灵活性</option>
                  <option value="mixed">混合</option>
                  <option value="none">无训练</option>
                </Select>
                <p className="-mt-1 text-xs text-mute">可多选；选择“无训练”时其余训练答案归零。</p>
                <Field
                  label="训练次数/周"
                  name="trainingSessionsPerWeek"
                  type="number"
                  min="0"
                  max="14"
                  defaultValue={existingActivity?.trainingSessionsPerWeek ?? ''}
                  disabled={noTraining}
                  required={!noTraining}
                />
                <Field
                  label="每次训练分钟"
                  name="trainingMinutesPerSession"
                  type="number"
                  min="0"
                  max="600"
                  defaultValue={existingActivity?.trainingMinutesPerSession ?? ''}
                  disabled={noTraining}
                  required={!noTraining}
                />
                <Select
                  label="训练强度"
                  name="trainingIntensity"
                  value={noTraining ? 'none' : trainingIntensity}
                  onChange={(event) =>
                    setTrainingIntensity(
                      event.target.value as (typeof TRAINING_INTENSITIES)[number] | '',
                    )
                  }
                  disabled={noTraining}
                  required={!noTraining}
                >
                  <option value="">请选择</option>
                  <option value="light">轻</option>
                  <option value="moderate">中</option>
                  <option value="vigorous">高</option>
                  <option value="mixed">混合</option>
                  {noTraining && <option value="none">无</option>}
                </Select>
                <Field
                  label="目标体重（公斤）"
                  name="targetWeightKg"
                  type="number"
                  min="20"
                  max="300"
                  step="0.1"
                  value={targetWeight}
                  onChange={(event) => setTargetWeight(event.target.value)}
                  required
                />
                <Field
                  label="每周减重（公斤）"
                  name="targetLossKgPerWeek"
                  type="number"
                  min="0.001"
                  max="0.5"
                  step="0.001"
                  value={weeklyLoss}
                  onChange={(event) => setWeeklyLoss(event.target.value)}
                  required
                />
                <p className="text-xs leading-5 text-mute">
                  推算目标日期：{' '}
                  <output aria-label="推算目标日期">
                    {targetDatePreview || '完成体重与速度后显示'}
                  </output>
                </p>
                {targetDateError && (
                  <p role="alert" className="text-sm text-iron">
                    {targetDateError}
                  </p>
                )}
            </fieldset>
          </>
        )}

        <BlockerList blockers={blockers} />
        <p className="text-xs leading-5 text-mute">{NUTRITION_DISCLAIMER}</p>
        {error && (
          <p role="alert" className="text-sm text-iron">
            {error}
          </p>
        )}
        <Button
          type="submit"
          fullWidth
          loading={saving}
          disabled={completed || !validWeight || (hasGoal && !weightConfirmed)}
        >
          保存健康计划
        </Button>
      </form>
    </section>
  );
}

export function NutritionPlanSetup(props: NutritionPlanSetupProps) {
  const resetKey = `${props.date}:${props.existing?.id ?? 'new'}:${props.existing?.updatedAt ?? 'none'}`;
  return <NutritionPlanSetupState key={resetKey} {...props} />;
}
