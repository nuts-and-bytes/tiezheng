import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildJsonExport, downloadText } from '../../lib/exportData';
import {
  BackupImportError,
  parseBackupFile,
  restoreBackup,
  type RestoreCandidate,
} from '../../lib/importData';
import { DataRestorePanel } from './DataRestorePanel';

vi.mock('../../lib/exportData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/exportData')>();
  return { ...actual, buildJsonExport: vi.fn(), downloadText: vi.fn() };
});
vi.mock('../../lib/importData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/importData')>();
  return { ...actual, parseBackupFile: vi.fn(), restoreBackup: vi.fn() };
});

const candidate: RestoreCandidate = {
  schemaVersion: 1,
  preview: {
    exportedAt: '2026-08-04T08:30:00.000Z',
    workoutDays: 12,
    exercises: 8,
    sets: 86,
    weightLogs: 4,
  },
  data: {
    workouts: [],
    workoutItems: [],
    exercises: [],
    weightLogs: [],
    profile: [],
  },
};

function backupFile(): File {
  return new File(['{}'], 'tiezheng-2026-08-04.json', { type: 'application/json' });
}

function renderPanel() {
  const onRestored = vi.fn();
  const view = render(<DataRestorePanel onRestored={onRestored} />);
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  return { ...view, input, onRestored };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parseBackupFile).mockResolvedValue(candidate);
  vi.mocked(restoreBackup).mockResolvedValue({ workoutDays: 12 });
  vi.mocked(buildJsonExport).mockResolvedValue('{"schemaVersion":1}');
});

test('选择备份后显示统计和两种恢复方式的明确区别', async () => {
  const user = userEvent.setup();
  const { input } = renderPanel();

  expect(screen.getByRole('button', { name: '从 JSON 恢复' })).toBeInTheDocument();
  await user.upload(input, backupFile());

  const dialog = await screen.findByRole('dialog', { name: '恢复数据' });
  expect(within(dialog).getByText('12 天')).toBeInTheDocument();
  expect(within(dialog).getByText('8 个')).toBeInTheDocument();
  expect(within(dialog).getByText('86 组')).toBeInTheDocument();
  expect(within(dialog).getByText('4 条')).toBeInTheDocument();
  expect(within(dialog).getByRole('radio', { name: /安全合并/ })).toBeChecked();
  expect(within(dialog).getByText(/保留当前记录，并加入备份数据/)).toBeInTheDocument();
  expect(within(dialog).getByText(/用备份替换当前训练、动作、体重和个人设置/)).toBeInTheDocument();
  expect(within(dialog).getByText(/不会改动本机照片/)).toBeInTheDocument();
});

test('恢复预览的 display 字体容器不包含中文', async () => {
  const user = userEvent.setup();
  const { input, container } = renderPanel();
  await user.upload(input, backupFile());
  await screen.findByRole('dialog', { name: '恢复数据' });

  for (const element of container.querySelectorAll('.display')) {
    expect(element.textContent ?? '').not.toMatch(/[一-鿿]/);
  }
});

test('安全合并是默认操作，成功后显示恢复天数', async () => {
  const user = userEvent.setup();
  const { input, onRestored } = renderPanel();
  await user.upload(input, backupFile());

  await user.click(await screen.findByRole('button', { name: '开始安全合并' }));

  expect(restoreBackup).toHaveBeenCalledWith(candidate, 'merge');
  expect(await screen.findByText('已恢复 12 天训练记录')).toBeInTheDocument();
  expect(onRestored).toHaveBeenCalledOnce();
});

test('完整覆盖先下载当前备份，二次确认后才恢复', async () => {
  const user = userEvent.setup();
  const { input } = renderPanel();
  await user.upload(input, backupFile());
  await user.click(await screen.findByRole('radio', { name: /完整覆盖/ }));

  await user.click(screen.getByRole('button', { name: '准备完整覆盖' }));

  expect(buildJsonExport).toHaveBeenCalledOnce();
  expect(downloadText).toHaveBeenCalledWith(
    expect.stringMatching(/^tiezheng-before-restore-\d{4}-\d{2}-\d{2}\.json$/),
    '{"schemaVersion":1}',
    'application/json',
  );
  expect(restoreBackup).not.toHaveBeenCalled();
  expect(await screen.findByText(/当前数据备份已下载/)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: '确认覆盖' }));

  expect(restoreBackup).toHaveBeenCalledWith(candidate, 'replace');
});

test('自动备份下载失败时禁止完整覆盖', async () => {
  vi.mocked(downloadText).mockImplementationOnce(() => {
    throw new Error('download failed');
  });
  const user = userEvent.setup();
  const { input } = renderPanel();
  await user.upload(input, backupFile());
  await user.click(await screen.findByRole('radio', { name: /完整覆盖/ }));

  await user.click(screen.getByRole('button', { name: '准备完整覆盖' }));

  expect(await screen.findByText('无法保存当前数据，未执行覆盖')).toBeInTheDocument();
  expect(restoreBackup).not.toHaveBeenCalled();
});

test('文件错误显示可理解的分类提示', async () => {
  vi.mocked(parseBackupFile).mockRejectedValueOnce(
    new BackupImportError('future-version', '备份来自更新版本，请先更新铁证'),
  );
  const user = userEvent.setup();
  const { input } = renderPanel();

  await user.upload(input, backupFile());

  expect(await screen.findByText('备份来自更新版本，请先更新铁证')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
