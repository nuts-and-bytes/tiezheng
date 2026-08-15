import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { track } from '../../lib/analytics';
import { TodayNutritionSummary } from './TodayNutritionSummary';

vi.mock('../../lib/analytics', { spy: true });

beforeEach(() => {
  vi.clearAllMocks();
});

function renderSummary() {
  return render(
    <MemoryRouter>
      <TodayNutritionSummary />
    </MemoryRouter>,
  );
}

test('展示今日饮食入口与记录提示，但不引入热量区域', () => {
  const { container } = renderSummary();

  expect(screen.getByRole('region', { name: '今日饮食' })).toBeInTheDocument();
  expect(screen.getByText('记录今天吃了什么')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '进入健康' })).toHaveAttribute('href', '/health');
  expect(container.querySelector('.heat')).toBeNull();
});

test('点击进入健康只记录一次 health_opened', async () => {
  const user = userEvent.setup();
  renderSummary();

  await user.click(screen.getByRole('link', { name: '进入健康' }));

  expect(track).toHaveBeenCalledTimes(1);
  expect(track).toHaveBeenCalledWith('health_opened');
});
