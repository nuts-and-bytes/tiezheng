import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { screenOf, trackScreen } from '../lib/analytics';

/**
 * 屏幕使用记录。存在的理由不是"加个统计"，是替代 umami 的 auto-track ——
 * 那玩意会把真实 URL 原样上报，而我们的路由是 #/day/2026-07-14。
 * 它关掉了（见 lib/analytics.ts），使用记录改由这里出：路径先经 screenOf 折叠成白名单
 * 字面量，日期在进入上报通道之前就已经不存在了。
 */
export function ScreenTracker() {
  const { pathname } = useLocation();
  useEffect(() => {
    const screen = screenOf(pathname);
    if (screen) trackScreen(screen);
  }, [pathname]);
  return null;
}
