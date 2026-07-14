import {
  BarController, BarElement, CategoryScale, Chart as ChartJS, Filler, LinearScale,
  LineController, LineElement, PointElement, RadarController, RadialLinearScale, Tooltip,
} from 'chart.js';
import { FONT, THEME } from '../lib/theme';

// 控制器必须在此显式注册：react-chartjs-2 的注册是模块顶层副作用，
// 生产构建 tree-shaking 会删掉未引用组件的注册（线上曾因此崩 "bar is not a registered controller"）
ChartJS.register(
  BarController, LineController, RadarController,
  RadialLinearScale, CategoryScale, LinearScale,
  PointElement, LineElement, BarElement, Filler, Tooltip,
);

// 轴标签 / 刻度 / 网格线是这个界面的一部分，不是 Chart.js 的一部分。
// 曾经这里写的是 iOS 系统灰（#8e8e93 / #2c2c2e）——一套压根不属于这个 app 的颜色。
ChartJS.defaults.color = THEME.mute;
ChartJS.defaults.borderColor = THEME.line;
ChartJS.defaults.font.family = FONT.body;

/**
 * 网格线的对比度是一笔**独立预算**，不能跟 --color-line（发丝线，白 .07）共用：
 * 发丝线画在纯背景上，网格线要穿过 alpha .12 的橙色填充区。
 *
 * 原值白 .05，在 THEME.bg 上只有约 12/255 的差值，本来就贴着感知阈值；填充把局部底色
 * 从 L≈10 抬到 L≈25，韦伯对比度当场腰斩——线不是被「盖住」，是被抬高的底噪**淹没**。
 * （一度以为是 Chart.js 的 z-order 坑。不是：source-over 下 alpha .12 至多把下层衰减 12%，
 *  把线挪到填充之上最终像素只差约 1/255，人眼分不出。层级不是变量，对比度才是。）
 *
 * 提到 .10 是给它留出穿过填充区还能被读出来的余量。
 */
export const CHART_GRID = 'rgba(255,255,255,0.10)';

export { Line, Radar, Chart as MixedChart } from 'react-chartjs-2';
