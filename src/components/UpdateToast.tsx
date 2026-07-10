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
      className="fixed left-1/2 top-[max(env(safe-area-inset-top),12px)] z-50 -translate-x-1/2 rounded-full bg-iron px-4 py-2 text-sm font-semibold text-white shadow-lg active:scale-95"
    >
      新版本已就绪 · 点击更新
    </button>
  );
}
