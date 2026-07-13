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

export { Line, Radar, Chart as MixedChart } from 'react-chartjs-2';
