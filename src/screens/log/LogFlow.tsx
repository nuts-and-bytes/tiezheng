import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { PartIcon } from '../../components/PartIcon';
import { PhotoCard } from '../../components/PhotoCard';
import { SetRows } from '../../components/SetRows';
import { Stamp } from '../../components/Stamp';
import { BODY_PARTS, bodyPartInfo } from '../../data/bodyParts';
import { todayStr } from '../../lib/dates';
import { vibrate } from '../../lib/platform';
import { hasOutOfRange, sanitizeSets } from '../../lib/validation';
import type { BodyPart, Exercise } from '../../lib/types';
import { addCustomExercise, getExercisesByIds, listByPart, seedPresets } from '../../repos/exerciseRepo';
import { commitDraft, listRecentExerciseIds } from '../../repos/workoutRepo';
import { useLogDraft } from '../../stores/logDraftStore';

/** 主 CTA：热源渐变是 CTA 的唯一上色方式（tokens.html） */
const CTA =
  'heat rounded-[20px] py-[19px] text-lg font-extrabold text-white shadow-[0_8px_32px_rgba(255,92,31,.35)] disabled:opacity-30 disabled:shadow-none active:scale-[.98]';
/** 次级按钮：不是卡片，只有一条发丝线 */
const GHOST =
  'rounded-[20px] border border-line py-[19px] font-semibold text-mute active:scale-[.98]';

function StepTitle({ step, children }: { step: number; children: string }) {
  return (
    <>
      <p className="display text-[11px] tracking-[.22em] text-mute">STEP {step} / 3</p>
      <h1 className="mt-1 text-[34px] leading-none font-black tracking-tight">{children}</h1>
    </>
  );
}

export function LogFlow() {
  const nav = useNavigate();
  const [step, setStep] = useState(() => {
    const s = useLogDraft.getState();
    return s.items.length > 0 ? 2 : s.parts.length > 0 ? 1 : 0;
  });
  const [done, setDone] = useState<{ moves: number; sets: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!useLogDraft.getState().active) useLogDraft.getState().start();
    // main.tsx 的灌库是即发即弃；这里兜底重试（幂等，写入完成后 liveQuery 自动重查刷新列表）
    void seedPresets();
  }, []);

  async function finish() {
    // 门闩：提交期间重入直接返回（ref 保证同 tick 连点也拦得住）
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const items = useLogDraft.getState().items.map((i) => ({
        exerciseId: i.exerciseId,
        sets: sanitizeSets(i.sets),
      }));
      await commitDraft(items, todayStr());
      // 钢印落下：震动 200ms（design card: 缩放 + 辉光 + 震动）
      vibrate(200);
      setDone({
        moves: items.filter((i) => i.sets.length > 0).length,
        sets: items.reduce((n, i) => n + i.sets.length, 0),
      });
      useLogDraft.getState().reset();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (done) return <DoneScreen moves={done.moves} sets={done.sets} />;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-8 pt-[max(env(safe-area-inset-top),16px)]">
      <header className="mb-6 flex items-center justify-between">
        <button type="button" onClick={() => nav(-1)} className="py-2 pr-4 text-mute">
          关闭
        </button>
        <span className="text-xs text-mute">草稿自动保存</span>
      </header>
      {step === 0 && <PickParts onNext={() => setStep(1)} />}
      {step === 1 && <PickExercises onBack={() => setStep(0)} onNext={() => setStep(2)} />}
      {step === 2 && <EditSets onBack={() => setStep(1)} onFinish={finish} submitting={submitting} />}
    </div>
  );
}

function PickParts({ onNext }: { onNext: () => void }) {
  const parts = useLogDraft((s) => s.parts);
  const togglePart = useLogDraft((s) => s.togglePart);
  return (
    <div className="flex flex-1 flex-col">
      <StepTitle step={1}>今天练哪儿？</StepTitle>
      <div className="etch" />
      {/* 七个部位、两列，除不尽 —— 末位孤零零占半行，剩下的高度全塌成空白，
          这一屏"空且呆"就是这么来的。让最后一个（有氧）横跨整行补上缺口，
          再把网格 flex-1 撑满：四行等分剩余高度，格子自己长高把空白吃掉。
          minmax(72px, 1fr)：小机型上有下限不至于压扁，大机型上按 1fr 长开。 */}
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-[repeat(4,minmax(72px,1fr))] gap-2.5">
        {BODY_PARTS.map((p, i) => {
          const selected = parts.includes(p.id);
          const wide = i === BODY_PARTS.length - 1;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={selected}
              onClick={() => togglePart(p.id)}
              className={`flex items-center justify-center rounded-[14px] text-[15px] font-semibold active:scale-[.97] ${
                wide ? 'col-span-2 flex-row gap-3' : 'flex-col gap-2'
              }`}
              style={
                selected
                  ? { border: `1.5px solid ${p.color}`, color: p.color, background: `${p.color}1a` }
                  : {
                      border: '1px solid var(--color-line)',
                      background: 'var(--color-raised)',
                      color: 'var(--color-ink)',
                    }
              }
            >
              {/* 瓷砖长高到 ~140px 后，28px 的图标又在格子里显得空 —— 空病会跟着容器
                  往下沉一层。图标得按容器配重：40px 撑得住这个格子，而放大本身零成本，
                  这七枚的糊化只发生在 20px 那一头 */}
              <PartIcon part={p.id} size={40} color={p.color} />
              {p.name}
            </button>
          );
        })}
      </div>
      <button type="button" disabled={parts.length === 0} onClick={onNext} className={`mt-3 ${CTA}`}>
        下一步 · 选动作
      </button>
    </div>
  );
}

function PickExercises({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [query, setQuery] = useState('');
  const parts = useLogDraft((s) => s.parts);
  const itemCount = useLogDraft((s) => s.items.length);
  return (
    <div className="flex flex-1 flex-col">
      <StepTitle step={2}>选动作</StepTitle>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索动作…"
        className="mt-5 rounded-xl border border-line bg-raised px-4 py-3 text-ink placeholder:text-mute"
      />
      <div className="flex flex-col overflow-y-auto">
        {parts.map((part) => (
          <PartSection key={part} part={part} query={query} />
        ))}
      </div>
      <div className="mt-auto flex gap-3 pt-8">
        <button type="button" onClick={onBack} className={`flex-1 ${GHOST}`}>
          上一步
        </button>
        <button type="button" disabled={itemCount === 0} onClick={onNext} className={`flex-[2] ${CTA}`}>
          下一步 · 记组数（{itemCount}）
        </button>
      </div>
    </div>
  );
}

function PartSection({ part, query }: { part: BodyPart; query: string }) {
  const [newName, setNewName] = useState('');
  // 门闩：写库期间重入直接返回（ref 保证同 tick 连点也拦得住，ExerciseManager 判例）
  const busyRef = useRef(false);
  const [creating, setCreating] = useState(false);
  const items = useLogDraft((s) => s.items);
  const addItem = useLogDraft((s) => s.addItem);
  const removeItemByExercise = useLogDraft((s) => s.removeItemByExercise);
  const data = useLiveQuery(async () => {
    const [list, recent] = await Promise.all([listByPart(part), listRecentExerciseIds()]);
    const rank = (e: Exercise) => {
      const i = recent.indexOf(e.id);
      return i === -1 ? 99 : i;
    };
    return list.sort((a, b) => rank(a) - rank(b));
  }, [part]);
  const info = bodyPartInfo(part);
  const shown = (data ?? []).filter((e) => !query || e.name.includes(query));

  async function create() {
    if (busyRef.current) return;
    busyRef.current = true;
    setCreating(true);
    try {
      const ex = await addCustomExercise(newName, part);
      addItem(ex.id);
      setNewName('');
    } finally {
      busyRef.current = false;
      setCreating(false);
    }
  }

  return (
    <section>
      {/* 发丝线取代卡片：区块靠线和留白分开，不靠一层灰底 */}
      <div className="etch" />
      <h2 className="mb-3 flex items-center gap-2 text-[13px] font-bold tracking-wide">
        <PartIcon part={part} size={18} />
        <span style={{ color: info.color }}>{info.name}</span>
      </h2>
      <div className="flex flex-wrap gap-2">
        {shown.map((e) => {
          const chosen = items.some((i) => i.exerciseId === e.id);
          return (
            <button
              key={e.id}
              type="button"
              aria-pressed={chosen}
              onClick={() => (chosen ? removeItemByExercise(e.id) : addItem(e.id))}
              className="rounded-full px-4 py-2 text-sm active:scale-95"
              style={
                chosen
                  ? {
                      border: `1.5px solid ${info.color}`,
                      color: info.color,
                      background: `${info.color}1a`,
                      fontWeight: 600,
                    }
                  : {
                      border: '1px solid var(--color-line)',
                      background: 'var(--color-raised)',
                      color: 'var(--color-ink)',
                    }
              }
            >
              {e.name}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={`新建${info.name}动作…`}
          className="flex-1 rounded-lg border border-line bg-raised px-3 py-2 text-sm text-ink placeholder:text-mute"
        />
        <button
          type="button"
          disabled={newName.trim() === '' || creating}
          onClick={() => create()}
          className="rounded-lg border border-line bg-raised px-3 py-2 text-sm font-semibold text-iron disabled:opacity-30"
        >
          新建
        </button>
      </div>
    </section>
  );
}

function EditSets({
  onBack,
  onFinish,
  submitting,
}: {
  onBack: () => void;
  onFinish: () => void;
  submitting: boolean;
}) {
  const items = useLogDraft((s) => s.items);
  const updateSets = useLogDraft((s) => s.updateSets);
  const removeItem = useLogDraft((s) => s.removeItem);
  const names = useLiveQuery(
    () => getExercisesByIds(items.map((i) => i.exerciseId)),
    [items.length],
  );
  return (
    <div className="flex flex-1 flex-col">
      <StepTitle step={3}>记组数</StepTitle>
      <div className="flex flex-col overflow-y-auto">
        {items.map((item, index) => (
          // 一动作一张卡 → 一动作一段：发丝线分隔，重量靠字号/字重立起来
          <div key={item.exerciseId}>
            <div className="etch" />
            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-xl font-bold tracking-tight">
                {names?.get(item.exerciseId)?.name ?? '…'}
              </span>
              <button type="button" onClick={() => removeItem(index)} className="text-xs text-mute">
                移除
              </button>
            </div>
            <SetRows sets={item.sets} onChange={(sets) => updateSets(index, sets)} />
          </div>
        ))}
      </div>
      <div className="mt-auto flex gap-3 pt-8">
        <button type="button" onClick={onBack} className={`flex-1 ${GHOST}`}>
          上一步
        </button>
        <button
          type="button"
          disabled={items.length === 0 || submitting || items.some((i) => hasOutOfRange(i.sets))}
          onClick={onFinish}
          className={`flex-[2] ${CTA}`}
        >
          完成打卡
        </button>
      </div>
    </div>
  );
}

function DoneScreen({ moves, sets }: { moves: number; sets: number }) {
  const nav = useNavigate();
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-8 pb-8 text-center">
      {/* 打卡 = 盖钢印。这是全 App 唯一一次让钢印落下的时刻 */}
      <Stamp size={112} animate />
      <h1 className="mt-8 text-[32px] leading-none font-black tracking-tight">已留下铁证</h1>
      <p className="mt-4 flex items-baseline gap-2 text-sm text-mute">
        <span className="display heat-text text-3xl">{moves}</span>
        个动作
        <span className="text-line">·</span>
        <span className="display heat-text text-3xl">{sets}</span>
        组
      </p>
      <div className="mt-8 w-full">
        <PhotoCard date={todayStr()} />
      </div>
      <button type="button" onClick={() => nav('/')} className={`mt-8 w-full ${CTA}`}>
        回到今日
      </button>
    </div>
  );
}
