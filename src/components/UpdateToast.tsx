import { useRegisterSW } from 'virtual:pwa-register/react';

/** 规格 §11：新版本顶部提示「点击更新」 */
export function UpdateToast() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;
  return (
    <button
      type="button"
      onClick={() => updateServiceWorker(true)}
      // 浮层用 raised + 发丝线，iron 只留给那一个字：热源必须稀缺
      className="fixed left-1/2 top-[max(env(safe-area-inset-top),12px)] z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-raised px-4 py-2 text-sm font-semibold text-ink shadow-[0_12px_40px_rgba(0,0,0,.55)] active:scale-95"
    >
      新版本已就绪 · 点击更新
    </button>
  );
}
