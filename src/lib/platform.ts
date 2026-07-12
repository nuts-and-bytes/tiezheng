import { log } from './logger';

/** 震动。jsdom / 桌面浏览器没有 vibrate；无用户手势时部分浏览器还会抛。一律静默 */
export function vibrate(ms: number): void {
  const nav = navigator as Navigator & { vibrate?: (p: number) => boolean };
  if (typeof nav.vibrate !== 'function') return;
  try {
    nav.vibrate(ms);
  } catch {
    /* 无手势时抛 —— 震动失败不该影响业务 */
  }
}

type ShareNav = Navigator & {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
};

/** 能否分享文件。必须同时有 share 和 canShare —— 只有 share 的老 Android 会在传 files 时静默失败 */
export function canShareFiles(files: File[]): boolean {
  const nav = navigator as ShareNav;
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    return nav.canShare({ files });
  } catch {
    return false;
  }
}

/**
 * 同步发起文件分享。
 *
 * 返回 boolean 而不是 Promise，是为了在调用点强制「无 await」：
 * iOS WebKit 的 transient activation 只在用户手势的同步调用栈里有效，
 * 一旦 `await toBlob()` 再调 share，授权已失效 → NotAllowedError。
 * 所以 blob 必须提前备好，onClick 里只能同步取用。
 */
export function shareFiles(files: File[], title: string): boolean {
  if (!canShareFiles(files)) return false;
  const nav = navigator as ShareNav;
  try {
    void nav.share!({ files, title }).catch((err: unknown) => {
      // 用户取消分享面板会 reject AbortError —— 不是错误
      if (err instanceof Error && err.name === 'AbortError') return;
      log(`share: ${String(err)}`);
    });
    return true;
  } catch (err) {
    log(`share sync: ${String(err)}`);
    return false;
  }
}
