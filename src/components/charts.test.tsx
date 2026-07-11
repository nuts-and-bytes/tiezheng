import { Chart as ChartJS } from 'chart.js';
import { describe, expect, it, vi } from 'vitest';

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
});
