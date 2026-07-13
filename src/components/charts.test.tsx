import { Chart as ChartJS } from 'chart.js';
import { describe, expect, it, vi } from 'vitest';
import { FONT, THEME } from '../lib/theme';

// 关键前提：react-chartjs-2 的 Bar/Line/Radar 组件在模块顶层用 /* #__PURE__ */
// 副作用注册控制器，生产构建 tree-shaking 会把未引用的组件连同注册一起删掉
// （线上 #/stats 崩溃 `"bar" is not a registered controller.` 的根因）。
// 这里 mock 掉整个包，确保注册必须由 charts.tsx 自己显式完成。
vi.mock('react-chartjs-2', () => ({
  Line: () => null,
  Radar: () => null,
  Chart: () => null,
}));

describe('charts 模块注册', () => {
  it('显式注册了 stats 页用到的全部控制器（bar/line/radar）', async () => {
    await import('./charts');
    expect(() => ChartJS.registry.getController('bar')).not.toThrow();
    expect(() => ChartJS.registry.getController('line')).not.toThrow();
    expect(() => ChartJS.registry.getController('radar')).not.toThrow();
  });

  /**
   * 轴标签、刻度、网格线是这个界面的一部分，不是 Chart.js 的一部分。
   * 它们曾经用的是 iOS 系统灰（#8e8e93 / #2c2c2e）——一套压根不属于这个 app 的颜色。
   * 见 src/lib/theme.test.ts。
   */
  it('默认色和字体取自 token，不是 Chart.js 自带的那套', async () => {
    await import('./charts');
    expect(ChartJS.defaults.color).toBe(THEME.mute);
    expect(ChartJS.defaults.borderColor).toBe(THEME.line);
    expect(ChartJS.defaults.font.family).toBe(FONT.body);
  });
});
