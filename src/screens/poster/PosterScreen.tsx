import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { todayStr } from '../../lib/dates';
import { canShareFiles, shareFiles, vibrate } from '../../lib/platform';
import {
  POSTER_SCALE,
  buildMonthly,
  buildYearly,
  drawPoster,
  posterFileName,
  posterSize,
  posterTitle,
  type PosterData,
  type PosterInput,
} from '../../lib/poster';
import { yearsWithData } from '../../lib/stats';
import { getExercisesByIds } from '../../repos/exerciseRepo';
import { listAllItems, listAllWorkoutDates } from '../../repos/workoutRepo';

type Mode = 'monthly' | 'yearly';

/**
 * 海报预览 + 本地导出。
 *
 * 两个不能绕的坑：
 * 1. **blob 必须在用户点击之前就备好**。canvas.toBlob 是异步的，而 iOS WebKit 的
 *    navigator.share 只在用户手势的**同步调用栈**里有效——onClick 里一旦 await，
 *    transient activation 就没了，直接 NotAllowedError。所以：进预览就画、就 toBlob，
 *    onClick 只做「同步取出已经在手的 File → shareFiles」。
 * 2. shareFiles 返回 boolean 不是 Promise，**绝不许 await**（见 lib/platform.ts）。
 *
 * 隐私（产品铁律 7）：数据只从 listAllItems / listAllWorkoutDates 取——
 * RangeItem 结构里根本没有 note 字段，所以 note 不是「我们记得躲开」，而是压根进不来。
 */
export function PosterScreen() {
  const nav = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [mode, setMode] = useState<Mode>('monthly');
  const [pickedYm, setPickedYm] = useState<string | null>(null);
  const [pickedYear, setPickedYear] = useState<number | null>(null);
  /** 备好的成品：点击时同步取用。没备好时按钮是禁用的 */
  const [ready, setReady] = useState<{ file: File; title: string } | null>(null);

  const src = useLiveQuery<PosterInput | undefined>(async () => {
    const [dates, items] = await Promise.all([listAllWorkoutDates(), listAllItems()]);
    const exMap = await getExercisesByIds([...new Set(items.map((i) => i.exerciseId))]);
    return { items, dates, exMap };
  }, []);

  const months = useMemo(() => {
    if (!src) return [];
    return [...new Set(src.dates.map((d) => d.slice(0, 7)))].sort().reverse();
  }, [src]);
  const years = useMemo(() => (src ? yearsWithData(src.dates) : []), [src]);

  const hasData = (src?.dates.length ?? 0) > 0;
  const ym = pickedYm ?? months[0] ?? todayStr().slice(0, 7);
  const year = pickedYear ?? years[0] ?? new Date().getFullYear();

  const data: PosterData | null = useMemo(() => {
    if (!src || !hasData) return null;
    return mode === 'monthly' ? buildMonthly(ym, src) : buildYearly(year, src);
  }, [src, hasData, mode, ym, year]);

  // 画 + 烘 blob。data 一变就重来，旧 blob 立刻作废（不能让用户把上个月的海报导出去）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!data || !canvas) return;

    let cancelled = false;
    setReady(null);

    void (async () => {
      await ensureFonts(); // Anton 是内联子集，没就位就画会掉成后备字体
      if (cancelled) return;

      const { w, h } = posterSize(data);
      canvas.width = w * POSTER_SCALE;
      canvas.height = h * POSTER_SCALE;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      drawPoster(ctx, data);

      canvas.toBlob((blob) => {
        if (cancelled || !blob) return;
        setReady({
          file: new File([blob], posterFileName(data), { type: 'image/png' }),
          title: posterTitle(data),
        });
      }, 'image/png');
    })();

    return () => {
      cancelled = true;
    };
  }, [data]);

  /** 必须全程同步：中间任何一个 await 都会让 iOS 吞掉分享面板 */
  function exportPoster() {
    if (!ready) return;
    vibrate(18);
    if (shareFiles([ready.file], ready.title)) return; // ← 不许 await
    download(ready.file);
  }

  const shareable = ready ? canShareFiles([ready.file]) : false;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col pt-[calc(env(safe-area-inset-top)+8px)] pb-[calc(env(safe-area-inset-bottom)+20px)]">
      <header className="flex items-center justify-between px-5">
        <button type="button" onClick={() => nav(-1)} className="py-2 pr-2 text-mute">
          返回
        </button>
        <h1 className="text-[15px] font-semibold">海报</h1>
        <span className="w-9" aria-hidden /> {/* 占位，让标题居中 */}
      </header>

      {!hasData ? (
        <EmptyState onStart={() => nav('/log')} loading={src === undefined} />
      ) : (
        <>
          {/* 月度 / 年度：这一屏唯一的开关，其余全是内容 */}
          <div className="mt-2 flex gap-1 self-center rounded-xl bg-raised p-1">
            {(
              [
                ['monthly', '月度'],
                ['yearly', '年度'],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => {
                  vibrate(8);
                  setMode(m);
                }}
                className={`rounded-lg px-5 py-1.5 text-[13px] transition-colors ${
                  mode === m ? 'bg-iron font-semibold text-white' : 'text-mute'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 期数切换：横向滚动的小铭牌，不做成一块卡 */}
          <div className="mt-4 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none]">
            {mode === 'monthly'
              ? months.map((m) => (
                  <Chip
                    key={m}
                    on={m === ym}
                    onClick={() => {
                      vibrate(8);
                      setPickedYm(m);
                    }}
                  >
                    <ChipLabel ym={m} />
                  </Chip>
                ))
              : years.map((y) => (
                  <Chip
                    key={y}
                    on={y === year}
                    onClick={() => {
                      vibrate(8);
                      setPickedYear(y);
                    }}
                  >
                    <span className="display">{y}</span>
                  </Chip>
                ))}
          </div>

          {/* 海报是一件实物 —— 它配得上浮起来。
              画布是 9:16（1080×1920），比例交给 canvas 自己的 width/height 属性。
              self-center 不是装饰：canvas 是 replaced element，在 flex 行里默认 align-items:stretch
              会把它的交叉轴（高）拉到整行高度，固有比例保护不了它（CSS Flexbox §9.4）——
              一旦 max-w 先于 max-h 触底（宽屏/高视口），9:16 就被抻长。align-self:center 让它
              退回按固有比例缩放。手机上因 max-h 先触底而侥幸正常，所以这个 bug 只在平板/桌面现形。 */}
          <div className="mt-5 flex flex-1 justify-center px-5">
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={`${mode === 'monthly' ? '月度' : '年度'}训练海报预览`}
              className="block h-auto max-h-[52dvh] w-auto max-w-[280px] self-center rounded-md shadow-[0_18px_50px_rgba(0,0,0,.55)]"
            />
          </div>

          <div className="mt-6 px-5">
            <button
              type="button"
              onClick={exportPoster}
              disabled={!ready}
              className="heat w-full rounded-2xl py-4 text-[15px] font-bold text-white shadow-[0_8px_28px_rgba(255,92,31,.32)] active:scale-[.98] disabled:opacity-40"
            >
              {shareable ? '分享 / 存图' : '下载海报'}
            </button>
            <p className="mt-3 text-center text-[11px] text-mute">
              全本地生成 · 零网络请求 · 照片不上传
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Anton（.display）只戴在数字上——单位、月份字交给正文字体，由调用方决定（见 ChipLabel）。
 * Chip 整块套 display，「月」就会掉进后备字体：紧挨着一个压缩重体的数字，字宽字重基线全对不上。
 */
function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`shrink-0 rounded-lg px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors ${
        on ? 'bg-iron/15 text-iron' : 'text-mute'
      }`}
    >
      {children}
    </button>
  );
}

function EmptyState({ onStart, loading }: { onStart: () => void; loading: boolean }) {
  if (loading) return <div className="flex-1" />;
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
      <p className="text-[17px] font-bold">还没有可晒的铁证</p>
      <p className="mt-3 text-[13px] leading-[1.8] text-mute">
        先去打一次卡。练过的每一天，都会落在海报上。
      </p>
      <button
        type="button"
        onClick={onStart}
        className="heat mt-8 rounded-2xl px-7 py-3 text-[14px] font-bold text-white"
      >
        去打卡
      </button>
    </div>
  );
}

/**
 * '2026-07' → 7月；往年的显示成 2025.12。
 * 数字走 Anton，「月」走正文字体——Anton 的内联子集里没有 CJK 字形。
 */
function ChipLabel({ ym }: { ym: string }) {
  const [y, m] = ym.split('-').map(Number);
  if (y !== new Date().getFullYear()) return <span className="display">{`${y}.${m}`}</span>;
  return (
    <>
      <span className="display">{m}</span>
      <span className="ml-0.5 text-[11px]">月</span>
    </>
  );
}

/** Anton 是内联的数字子集（font-display:block）。没就位就画会掉成后备字体，宽度全错。 */
async function ensureFonts(): Promise<void> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  try {
    await fonts.load('120px Anton', '0123456789.');
    await fonts.ready;
  } catch {
    /* 字体没加载上也得出图——后备字体照样能画 */
  }
}

/** 不支持 Web Share 的浏览器（桌面 Chrome / 老 Android）降级成下载 */
function download(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
