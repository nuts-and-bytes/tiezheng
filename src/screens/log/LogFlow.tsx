import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { SetRows } from '../../components/SetRows';
import { BODY_PARTS, bodyPartInfo } from '../../data/bodyParts';
import { todayStr } from '../../lib/dates';
import { sanitizeSets } from '../../lib/validation';
import type { BodyPart, Exercise } from '../../lib/types';
import { addCustomExercise, getExercisesByIds, listByPart, seedPresets } from '../../repos/exerciseRepo';
import { commitDraft, listRecentExerciseIds } from '../../repos/workoutRepo';
import { useLogDraft } from '../../stores/logDraftStore';

export function LogFlow() {
  const nav = useNavigate();
  const draft = useLogDraft();
  const [step, setStep] = useState(() => {
    const s = useLogDraft.getState();
    return s.items.length > 0 ? 2 : s.parts.length > 0 ? 1 : 0;
  });
  const [done, setDone] = useState<{ moves: number; sets: number } | null>(null);

  useEffect(() => {
    if (!useLogDraft.getState().active) useLogDraft.getState().start();
  }, []);

  async function finish() {
    const items = useLogDraft.getState().items.map((i) => ({
      exerciseId: i.exerciseId,
      sets: sanitizeSets(i.sets),
    }));
    await commitDraft(items, todayStr());
    setDone({
      moves: items.filter((i) => i.sets.length > 0).length,
      sets: items.reduce((n, i) => n + i.sets.length, 0),
    });
    useLogDraft.getState().reset();
  }

  if (done) return <DoneScreen moves={done.moves} sets={done.sets} />;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-8 pt-[max(env(safe-area-inset-top),16px)]">
      <header className="mb-4 flex items-center justify-between">
        <button type="button" onClick={() => nav(-1)} className="py-2 pr-4 text-mute">
          关闭
        </button>
        <span className="text-xs text-mute">草稿自动保存</span>
      </header>
      {step === 0 && <PickParts onNext={() => setStep(1)} />}
      {step === 1 && <PickExercises onBack={() => setStep(0)} onNext={() => setStep(2)} />}
      {step === 2 && <EditSets onBack={() => setStep(1)} onFinish={finish} />}
    </div>
  );

  function PickParts({ onNext }: { onNext: () => void }) {
    return (
      <div className="flex flex-1 flex-col">
        <h1 className="mb-6 text-3xl font-bold">今天练哪儿？</h1>
        <div className="grid grid-cols-2 gap-3">
          {BODY_PARTS.map((p) => {
            const selected = draft.parts.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => draft.togglePart(p.id)}
                className={`flex items-center gap-3 rounded-2xl border p-4 text-left text-lg font-semibold active:scale-[.97] ${
                  selected ? 'border-iron bg-iron/10' : 'border-line bg-card'
                }`}
              >
                <span className="h-3 w-3 rounded-full" style={{ background: p.color }} />
                {p.name}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          disabled={draft.parts.length === 0}
          onClick={onNext}
          className="mt-auto rounded-2xl bg-iron py-4 text-lg font-bold text-white disabled:opacity-30 active:scale-[.98]"
        >
          下一步 · 选动作
        </button>
      </div>
    );
  }

  function PickExercises({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
    const [query, setQuery] = useState('');
    return (
      <div className="flex flex-1 flex-col gap-4">
        <h1 className="text-3xl font-bold">选动作</h1>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索动作…"
          className="rounded-xl bg-card px-4 py-3 text-ink placeholder:text-mute/60"
        />
        <div className="flex flex-col gap-5 overflow-y-auto">
          {draft.parts.map((part) => (
            <PartSection key={part} part={part} query={query} />
          ))}
        </div>
        <div className="mt-auto flex gap-3">
          <button type="button" onClick={onBack} className="flex-1 rounded-2xl bg-card py-4 font-semibold text-ink active:scale-[.98]">
            上一步
          </button>
          <button
            type="button"
            disabled={draft.items.length === 0}
            onClick={onNext}
            className="flex-[2] rounded-2xl bg-iron py-4 text-lg font-bold text-white disabled:opacity-30 active:scale-[.98]"
          >
            下一步 · 记组数（{draft.items.length}）
          </button>
        </div>
      </div>
    );
  }

  function PartSection({ part, query }: { part: BodyPart; query: string }) {
    const [newName, setNewName] = useState('');
    const data = useLiveQuery(async () => {
      await seedPresets();
      const [list, recent] = await Promise.all([listByPart(part), listRecentExerciseIds()]);
      const rank = (e: Exercise) => {
        const i = recent.indexOf(e.id);
        return i === -1 ? 99 : i;
      };
      return list.sort((a, b) => rank(a) - rank(b));
    }, [part]);
    const info = bodyPartInfo(part);
    const shown = (data ?? []).filter((e) => !query || e.name.includes(query));
    return (
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-mute">
          <span className="h-2 w-2 rounded-full" style={{ background: info.color }} />
          {info.name}
        </h2>
        <div className="flex flex-wrap gap-2">
          {shown.map((e) => {
            const chosen = draft.items.some((i) => i.exerciseId === e.id);
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => (chosen ? draft.removeItemByExercise(e.id) : draft.addItem(e.id))}
                className={`rounded-full px-4 py-2 text-sm active:scale-95 ${
                  chosen ? 'bg-iron font-semibold text-white' : 'bg-card text-ink'
                }`}
              >
                {e.name}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={`新建${info.name}动作…`}
            className="flex-1 rounded-lg bg-card2 px-3 py-2 text-sm text-ink placeholder:text-mute/60"
          />
          <button
            type="button"
            disabled={newName.trim() === ''}
            onClick={async () => {
              const ex = await addCustomExercise(newName, part);
              draft.addItem(ex.id);
              setNewName('');
            }}
            className="rounded-lg bg-card2 px-3 py-2 text-sm text-iron disabled:opacity-30"
          >
            新建
          </button>
        </div>
      </section>
    );
  }

  function EditSets({ onBack, onFinish }: { onBack: () => void; onFinish: () => void }) {
    const names = useLiveQuery(
      () => getExercisesByIds(draft.items.map((i) => i.exerciseId)),
      [draft.items.length],
    );
    return (
      <div className="flex flex-1 flex-col gap-4">
        <h1 className="text-3xl font-bold">记组数</h1>
        <div className="flex flex-col gap-4 overflow-y-auto">
          {draft.items.map((item, index) => (
            <div key={item.exerciseId} className="rounded-2xl bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="font-semibold">{names?.get(item.exerciseId)?.name ?? '…'}</span>
                <button type="button" onClick={() => draft.removeItem(index)} className="text-sm text-mute">
                  移除
                </button>
              </div>
              <SetRows sets={item.sets} onChange={(sets) => draft.updateSets(index, sets)} />
            </div>
          ))}
        </div>
        <div className="mt-auto flex gap-3">
          <button type="button" onClick={onBack} className="flex-1 rounded-2xl bg-card py-4 font-semibold text-ink active:scale-[.98]">
            上一步
          </button>
          <button
            type="button"
            disabled={draft.items.length === 0}
            onClick={onFinish}
            className="flex-[2] rounded-2xl bg-iron py-4 text-lg font-bold text-white disabled:opacity-30 active:scale-[.98]"
          >
            完成打卡
          </button>
        </div>
      </div>
    );
  }
}

function DoneScreen({ moves, sets }: { moves: number; sets: number }) {
  const nav = useNavigate();
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-8 text-center">
      <span className="text-6xl">🔥</span>
      <h1 className="text-3xl font-bold">已留下铁证</h1>
      <p className="text-mute">
        {moves} 个动作 · {sets} 组
      </p>
      <button
        type="button"
        onClick={() => nav('/')}
        className="mt-4 w-full rounded-2xl bg-iron py-4 text-lg font-bold text-white active:scale-[.98]"
      >
        回到今日
      </button>
    </div>
  );
}
