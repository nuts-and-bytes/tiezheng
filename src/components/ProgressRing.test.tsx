import { render } from '@testing-library/react';
import { ProgressRing } from './ProgressRing';

/** 默认 size=120 / stroke=10 下的周长 */
const C = 2 * Math.PI * ((120 - 10) / 2);

function ringOffset(container: HTMLElement): number {
  const circles = container.querySelectorAll('circle');
  // circles[0] 为底环，circles[1] 为进度环
  return Number(circles[1].getAttribute('stroke-dashoffset'));
}

test('value=0 时空环：偏移等于整个周长', () => {
  const { container } = render(<ProgressRing value={0} max={4} />);
  expect(ringOffset(container)).toBeCloseTo(C, 5);
});

test('value=max 时满环：偏移为 0', () => {
  const { container } = render(<ProgressRing value={4} max={4} />);
  expect(ringOffset(container)).toBeCloseTo(0, 5);
});

test('value 超过 max 时 clamp 到满环，不出现负偏移', () => {
  const { container } = render(<ProgressRing value={9} max={4} />);
  const offset = ringOffset(container);
  expect(offset).toBeCloseTo(0, 5);
  expect(offset).toBeGreaterThanOrEqual(0);
});

test('max=0 不除零：偏移有限且为空环', () => {
  const { container } = render(<ProgressRing value={3} max={0} />);
  const offset = ringOffset(container);
  expect(Number.isFinite(offset)).toBe(true);
  expect(offset).toBeCloseTo(C, 5);
});
