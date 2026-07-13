import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { SetEntry } from '../lib/types';
import { SetRows } from './SetRows';

function Harness({ initial = [{}] as SetEntry[] }) {
  const [sets, setSets] = useState<SetEntry[]>(initial);
  return <SetRows sets={sets} onChange={setSets} />;
}

/**
 * 旧行为：用户在腿举那一栏输 560，按保存 —— sanitizeSets 静默把 weight 剥掉，
 * 那组只剩次数入库。他回头看时重量栏是空的，以为自己忘了填。
 * app 假装他没做过那个操作，这是最坏的失败模式：**用户没有得到任何反馈**。
 *
 * 上限已放宽到 1000kg（腿举机是真的），但边界总归还在 —— 边界之外必须**看得见**。
 */
test('超出范围的重量：当场标红并说出范围，不再等到保存时静默丢弃', async () => {
  const user = userEvent.setup();
  render(<Harness />);

  const weight = screen.getByPlaceholderText('重量kg');
  await user.type(weight, '20260710'); // 日期串进重量栏

  expect(weight).toHaveAttribute('aria-invalid', 'true');
  expect(await screen.findByText(/0–1000/)).toBeInTheDocument();
});

test('超出范围的次数同样看得见', async () => {
  const user = userEvent.setup();
  render(<Harness />);

  const reps = screen.getByPlaceholderText('次数');
  await user.type(reps, '9999');

  expect(reps).toHaveAttribute('aria-invalid', 'true');
  expect(await screen.findByText(/1–500/)).toBeInTheDocument();
});

/** 对抗式护栏：别把正常输入也标红 */
test('范围内的值不标红、不出提示', async () => {
  const user = userEvent.setup();
  render(<Harness />);

  await user.type(screen.getByPlaceholderText('重量kg'), '560'); // 腿举机，真实值
  await user.type(screen.getByPlaceholderText('次数'), '12');

  expect(screen.getByPlaceholderText('重量kg')).toHaveAttribute('aria-invalid', 'false');
  expect(screen.queryByText(/0–1000/)).not.toBeInTheDocument();
});

/** 空栏是「还没填」，不是「填错了」—— 默认三行空白不该一片红 */
test('空栏不标红', () => {
  render(<Harness initial={[{}, {}, {}]} />);
  for (const el of screen.getAllByPlaceholderText('重量kg')) {
    expect(el).toHaveAttribute('aria-invalid', 'false');
  }
  expect(screen.queryByText(/0–1000/)).not.toBeInTheDocument();
});
