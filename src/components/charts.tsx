import {
  BarController, BarElement, CategoryScale, Chart as ChartJS, Filler, LinearScale,
  LineController, LineElement, PointElement, RadarController, RadialLinearScale, Tooltip,
} from 'chart.js';

// 控制器必须在此显式注册：react-chartjs-2 的注册是模块顶层副作用，
// 生产构建 tree-shaking 会删掉未引用组件的注册（线上曾因此崩 "bar is not a registered controller"）
ChartJS.register(
  BarController, LineController, RadarController,
  RadialLinearScale, CategoryScale, LinearScale,
  PointElement, LineElement, BarElement, Filler, Tooltip,
);

ChartJS.defaults.color = '#8e8e93';
ChartJS.defaults.borderColor = '#2c2c2e';
ChartJS.defaults.font.family = "-apple-system, 'PingFang SC', sans-serif";

export { Line, Radar, Chart as MixedChart } from 'react-chartjs-2';
