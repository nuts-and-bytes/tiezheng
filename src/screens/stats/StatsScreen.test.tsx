import { render } from '@testing-library/react';
import { Line } from '../../components/charts';

test('PROBE: chart.js 在 jsdom 里能不能渲染', () => {
  render(<Line data={{ labels: ['a', 'b'], datasets: [{ data: [1, 2] }] }} />);
});
