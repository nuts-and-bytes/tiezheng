import { fitWithin } from './image';

test('横图长边压到 1280', () => {
  expect(fitWithin(4000, 3000, 1280)).toEqual({ width: 1280, height: 960 });
});

test('竖图长边压到 1280', () => {
  expect(fitWithin(3000, 4000, 1280)).toEqual({ width: 960, height: 1280 });
});

test('小图不放大', () => {
  expect(fitWithin(800, 600, 1280)).toEqual({ width: 800, height: 600 });
});
