import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { todayStr } from '../../lib/dates';
import { autoNutritionTargetsEnabled } from '../../lib/nutritionFeatureFlags';
import { getEffectiveNutritionPlan } from '../../repos/nutritionPlanRepo';
import { NutritionPlanDetails, NutritionPlanSetup } from './NutritionPlanSetup';

const PLAN_LOADING = Symbol('plan-loading');

export function HealthScreen() {
  const navigate = useNavigate();
  const date = todayStr();
  const targetsEnabled = autoNutritionTargetsEnabled();
  const plan = useLiveQuery(() => getEffectiveNutritionPlan(date), [date], PLAN_LOADING);
  const [editing, setEditing] = useState(false);

  return (
    <main className="mx-auto min-h-dvh max-w-md px-5 pb-10 pt-[max(env(safe-area-inset-top),16px)]">
      <header>
        <Button
          variant="tertiary"
          aria-label="返回今日页"
          onClick={() => navigate('/', { replace: true })}
          className="-ml-4 size-11 p-0"
        >
          ←
        </Button>
      </header>

      <section className="mt-6">
        <p className="text-[11px] font-semibold tracking-[2px] text-amber">DAILY NUTRITION</p>
        <h1 className="mt-2 text-[28px] leading-[1.15] font-extrabold text-ink">健康</h1>
      </section>

      <div className="etch" />
      {plan === PLAN_LOADING ? (
        <section
          role="status"
          aria-label="正在读取健康计划"
          className="forged-surface min-h-40 animate-pulse rounded-2xl p-5 motion-reduce:animate-none"
        >
          <span className="sr-only">正在读取健康计划</span>
        </section>
      ) : !plan || editing ? (
        <NutritionPlanSetup
          key={`${date}:${plan?.id ?? 'new'}:${plan?.updatedAt ?? 'none'}`}
          date={date}
          existing={plan}
          onSaved={() => setEditing(false)}
        />
      ) : (
        <NutritionPlanDetails
          plan={plan}
          targetsEnabled={targetsEnabled}
          onEdit={() => setEditing(true)}
        />
      )}
    </main>
  );
}
