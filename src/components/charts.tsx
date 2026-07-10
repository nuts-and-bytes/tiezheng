import {
  BarElement, CategoryScale, Chart as ChartJS, Filler, LinearScale, LineElement,
  PointElement, RadialLinearScale, Tooltip,
} from 'chart.js';

ChartJS.register(
  RadialLinearScale, CategoryScale, LinearScale,
  PointElement, LineElement, BarElement, Filler, Tooltip,
);

ChartJS.defaults.color = '#8e8e93';
ChartJS.defaults.borderColor = '#2c2c2e';
ChartJS.defaults.font.family = "-apple-system, 'PingFang SC', sans-serif";

export { Line, Radar, Chart as MixedChart } from 'react-chartjs-2';
