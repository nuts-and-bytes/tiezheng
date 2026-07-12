import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Stamp } from '../components/Stamp';
import { PartIcon } from '../components/PartIcon';
import { BODY_PARTS } from '../data/bodyParts';
import { vibrate } from '../lib/platform';
import { saveProfile } from '../repos/profileRepo';

const GOALS = [3, 4, 5];
const STEP_COUNT = 4;

/** 每屏的无障碍名。getByRole('group') 只能拿到当前屏（其余屏 aria-hidden），
    读屏也靠它播报「第几步 / 这屏讲什么」。 */
const STEP_LABELS = ['品牌', '怎么记', '海报', '周目标'];

/** CTA 文案随屏切换。全局只此一个按钮 —— 四屏各挂一个同名按钮的话，
    jsdom 不实现 inert，离屏的「继续」照样点得动，测试会假绿。 */
const CTA_LABELS = ['开始', '继续', '继续', '开始第一次打卡'];

/** 屏 2 的三步流程。文案取自 design card：选部位 → 记几组 → 盖钢印 */
const HOW_STEPS = [
  { t: '选部位', d: '胸 / 背 / 腿…7 个部位各有图标' },
  { t: '记几组', d: '重量 × 次数，加减号快速输入' },
  { t: '盖钢印', d: '可顺手拍一张，只存本机' },
];

export function Onboarding() {
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState(4);
  const submittingRef = useRef(false);

  const last = step === STEP_COUNT - 1;

  function go(next: number) {
    vibrate(8);
    setStep(next);
  }

  async function start() {
    // 门闩：提交期间重入直接返回（ref 保证同 tick 连点也拦得住，LogFlow 判例）。
    // 成功后**不复位** —— 复位会让「点完第一次已落库、第二次点进来」的串行连点再写一遍。
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      vibrate(18);
      await saveProfile({ weeklyGoal: goal, onboarded: true });
      nav('/log');
    } catch (err) {
      submittingRef.current = false; // 写失败要允许重试
      throw err;
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col overflow-hidden pt-[calc(env(safe-area-inset-top)+20px)] pb-[calc(env(safe-area-inset-bottom)+24px)]">
      {/* 顶栏：进度 / 返回 / 跳过。全局渲染，不随轨道滑动 */}
      <header className="flex h-9 shrink-0 items-center justify-between px-7">
        <div className="flex items-center gap-3">
          {step > 0 && (
            <button
              type="button"
              onClick={() => go(step - 1)}
              aria-label="返回上一步"
              className="-ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-mute active:scale-90"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
          )}
          <span className="display text-[11px] tracking-[2px] text-mute" aria-hidden>
            {step + 1} / {STEP_COUNT}
          </span>
        </div>

        {/* 跳过：只在中间两屏出现（屏 1 要留住第一印象，屏 4 本身就是终点） */}
        {step > 0 && !last && (
          <button
            type="button"
            onClick={() => go(STEP_COUNT - 1)}
            className="-mr-2 px-2 py-1 text-[12px] text-mute active:scale-95"
          >
            跳过
          </button>
        )}
      </header>

      {/* 轨道：四屏全部挂载，靠 translateX 位移。非当前屏 aria-hidden + inert，
          读屏与 getByRole 都只看得见当前屏。 */}
      <div className="relative flex-1 overflow-hidden">
        <div
          className="flex h-full transition-transform duration-[520ms] ease-[cubic-bezier(.22,.9,.28,1)] motion-reduce:transition-none"
          style={{ transform: `translateX(-${step * 100}%)` }}
        >
          {STEP_LABELS.map((label, i) => (
            <section
              key={label}
              role="group"
              aria-label={`第 ${i + 1} 步，共 ${STEP_COUNT} 步：${label}`}
              aria-hidden={i !== step || undefined}
              inert={i !== step}
              className="flex w-full shrink-0 flex-col justify-center px-7"
            >
              {i === 0 && <BrandPanel />}
              {i === 1 && <HowPanel />}
              {i === 2 && <PosterPanel />}
              {i === 3 && <GoalPanel goal={goal} onPick={setGoal} />}
            </section>
          ))}
        </div>
      </div>

      {/* 底栏：进度点 + 唯一 CTA */}
      <div className="shrink-0 px-7">
        <div className="flex justify-center gap-[6px] pb-5" aria-hidden>
          {STEP_LABELS.map((label, i) => (
            <i
              key={label}
              className={`h-[5px] rounded-full transition-all duration-300 ${
                i === step ? 'w-4 bg-iron' : 'w-[5px] bg-white/15'
              }`}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={last ? start : () => go(step + 1)}
          className="heat w-full rounded-2xl py-4 text-[15px] font-bold text-white shadow-[0_8px_28px_rgba(255,92,31,.32)] active:scale-[.98]"
        >
          {CTA_LABELS[step]}
        </button>
      </div>
    </div>
  );
}

/* ── 屏 1：品牌 ───────────────────────────────────────────── */
function BrandPanel() {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-9">
        <Stamp size={92} animate />
      </div>
      <h1 className="text-[26px] leading-[1.45] font-bold text-balance">你练过的，都有铁证。</h1>
      <p className="mt-4 text-[13px] leading-[1.9] text-mute">
        数据只存你手机本地
        <br />
        无广告 · 无推销
      </p>
    </div>
  );
}

/* ── 屏 2：怎么记 ─────────────────────────────────────────── */
function HowPanel() {
  return (
    <div>
      <h2 className="text-[22px] leading-[1.4] font-bold">30 秒，盖下今天的印</h2>

      <ol className="mt-8 flex flex-col gap-5">
        {HOW_STEPS.map((s, i) => (
          <li key={s.t} className="flex items-center gap-3.5">
            <span className="display flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-iron/15 text-[13px] text-iron">
              {i + 1}
            </span>
            <span>
              <b className="block text-[14px] font-semibold">{s.t}</b>
              <span className="mt-0.5 block text-[11px] text-mute">{s.d}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="etch" />

      {/* 七个部位各有图标 —— 用户原话「各个部位没有对应的 logo」 */}
      <ul className="flex justify-between">
        {BODY_PARTS.map((p) => (
          <li key={p.id} className="flex flex-col items-center gap-1.5">
            <PartIcon part={p.id} size={22} />
            <span className="text-[10px] text-mute">{p.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── 屏 3：海报（用户点名要的分享钩子）─────────────────────── */
function PosterPanel() {
  return (
    <div>
      <h2 className="text-[22px] leading-[1.4] font-bold">月底，领你的海报</h2>
      <p className="mt-3 text-[13px] leading-[1.8] text-mute">
        月度 / 年度训练数据一键生成钢印海报，存进相册，发不发朋友圈你说了算。
      </p>

      {/* 海报示意：这是「可以浮起来」的东西 —— 它是一个实物，不是一段信息 */}
      <div className="mx-auto mt-7 w-[152px] rounded-xl border border-iron/25 bg-raised px-3.5 py-4 text-center shadow-[0_10px_34px_rgba(255,92,31,.16)]">
        <p className="display text-[8px] tracking-[2px] text-mute">IRONPROOF · 2026.07</p>
        <p className="display heat-text mt-1.5 text-[42px] leading-none">12</p>
        <p className="mt-1 text-[8px] text-mute">天 · 打卡</p>
        <div className="mt-3 flex justify-between text-[8px] text-mute">
          {[
            ['86', '组'],
            ['12.4t', '容量'],
            ['5', '连续'],
          ].map(([n, unit]) => (
            <span key={unit}>
              <b className="display block text-[12px] font-normal text-ink">{n}</b>
              {unit}
            </span>
          ))}
        </div>
        <div className="mt-3 flex justify-center">
          <Stamp size={22} decorative />
        </div>
      </div>

      <p className="mt-7 text-center text-[11px] leading-[1.7] text-mute">
        全本地生成 · 照片不上传
      </p>
    </div>
  );
}

/* ── 屏 4：周目标 ─────────────────────────────────────────── */
function GoalPanel({ goal, onPick }: { goal: number; onPick: (g: number) => void }) {
  return (
    <div className="text-center">
      <h2 className="text-[22px] leading-[1.4] font-bold">每周想练几次？</h2>
      <p className="mt-3 text-[13px] text-mute">定个能坚持的数，随时可改</p>

      <div className="mt-9 flex justify-center gap-3">
        {GOALS.map((g) => {
          const on = goal === g;
          return (
            <button
              key={g}
              type="button"
              aria-pressed={on}
              onClick={() => {
                vibrate(8);
                onPick(g);
              }}
              className={`display h-14 w-14 rounded-2xl text-[20px] transition-colors active:scale-95 ${
                on
                  ? 'bg-iron text-white shadow-[0_6px_22px_rgba(255,92,31,.38)]'
                  : 'bg-raised text-ink border border-line'
              }`}
            >
              {g}
            </button>
          );
        })}
      </div>
    </div>
  );
}
