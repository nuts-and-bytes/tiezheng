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
      // 浮层用 raised + 发丝线，iron 只留给那一个字：热源必须稀缺。
      //
      // 落点在安全区下方 52px，而不是贴顶 12px：header 高约 44px（8px 内边距 + py-2 的按钮），
      // 贴顶的居中胶囊会正好压在标题上。别的页标题左对齐，跟居中胶囊不相交，所以一直没人发现；
      // 海报页是唯一把标题居中的（iOS 详情页惯例），那句「海报」会被完全盖住。
      // 让它躲开所有 header，代价只是盖住一点正文——正文能滚，标题是找路用的。
      className="fixed left-1/2 top-[calc(env(safe-area-inset-top)+52px)] z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-raised px-4 py-2 text-sm font-semibold text-ink shadow-[0_12px_40px_rgba(0,0,0,.55)] active:scale-95"
    >
      新版本已就绪 · 点击更新
    </button>
  );
}
