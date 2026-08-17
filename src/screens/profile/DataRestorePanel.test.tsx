import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { buildJsonExport, downloadText } from '../../lib/exportData';
import {
  BackupImportError,
  parseBackupFile,
  previewRestore,
  restoreBackup,
  type ModeRestorePreview,
  type RestoreCandidate,
} from '../../lib/importData';
import { DataRestorePanel } from './DataRestorePanel';

vi.mock('../../lib/exportData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/exportData')>();
  return { ...actual, buildJsonExport: vi.fn(), downloadText: vi.fn() };
});
vi.mock('../../lib/importData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/importData')>();
  return {
    ...actual,
    parseBackupFile: vi.fn(),
    previewRestore: vi.fn(),
    restoreBackup: vi.fn(),
  };
});

const candidate: RestoreCandidate = {
  schemaVersion: 3,
  preview: {
    exportedAt: '2026-08-04T08:30:00.000Z',
    workoutDays: 12,
    exercises: 8,
    sets: 86,
    weightLogs: 4,
    nutritionPlans: 0,
    nutritionDays: 0,
    meals: 0,
    mealItems: 0,
  },
  data: {
    workouts: [],
    workoutItems: [],
    exercises: [],
    weightLogs: [],
    profile: [],
    nutritionPlans: [],
    foods: [],
    meals: [],
    mealItems: [],
  },
};

const defaultModePreview: ModeRestorePreview = {
  ...candidate.preview,
  fingerprint: 'preview-default',
  mealPhotosToDelete: 0,
  mealEstimatesToDiscard: 0,
};

function backupFile(): File {
  return new File(['{}'], 'tiezheng-2026-08-04.json', { type: 'application/json' });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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
  vi.mocked(previewRestore).mockResolvedValue(defaultModePreview);
  vi.mocked(restoreBackup).mockResolvedValue({ workoutDays: 12, nutritionDays: 0 });
  vi.mocked(buildJsonExport).mockResolvedValue('{"schemaVersion":3}');
});

test('选择备份后显示统计和两种恢复方式的明确区别', async () => {
  const user = userEvent.setup();
  const { input } = renderPanel();

  expect(screen.getByRole('button', { name: '从 JSON 恢复' })).toBeInTheDocument();
  await user.upload(input, backupFile());

  const dialog = await screen.findByRole('dialog', { name: '恢复数据' });
  expect(within(dialog).getByText('tiezheng-2026-08-04.json')).toBeInTheDocument();
  expect(within(dialog).getByText('12 天')).toBeInTheDocument();
  expect(within(dialog).getByText('8 个')).toBeInTheDocument();
  expect(within(dialog).getByText('86 组')).toBeInTheDocument();
  expect(within(dialog).getByText('4 条')).toBeInTheDocument();
  expect(within(dialog).getByRole('radio', { name: /安全合并/ })).toBeChecked();
  expect(within(dialog).getByText(/保留当前记录，并加入备份数据/)).toBeInTheDocument();
  expect(within(dialog).getByText(
    /用备份替换当前训练、动作、体重、个人设置、营养计划、餐次、食物条目和自定义食物/,
  )).toBeInTheDocument();
  expect(within(dialog).getByText(/体型照不参与恢复，也不会被改动/)).toBeInTheDocument();
  expect(within(dialog).getByText(/餐食缩略图不在备份中/)).toBeInTheDocument();
});

test('预览显示营养计划、饮食天数、餐次和食物条目计数', async () => {
  vi.mocked(parseBackupFile).mockResolvedValueOnce({
    ...candidate,
    preview: {
      ...candidate.preview,
      nutritionPlans: 2,
      nutritionDays: 3,
      meals: 7,
      mealItems: 12,
    },
  });
  const user = userEvent.setup();
  const { input } = renderPanel();
  await user.upload(input, backupFile());

  const nutritionPreview = await screen.findByLabelText('饮食备份预览');
  expect(within(nutritionPreview).getByText('2 份')).toBeInTheDocument();
  expect(within(nutritionPreview).getByText('3 天')).toBeInTheDocument();
  expect(within(nutritionPreview).getByText('7 餐')).toBeInTheDocument();
  expect(within(nutritionPreview).getByText('12 项')).toBeInTheDocument();
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

  const submit = await screen.findByRole('button', { name: '开始安全合并' });
  await waitFor(() => expect(submit).toBeEnabled());
  await user.click(submit);

  expect(restoreBackup).toHaveBeenCalledWith(candidate, 'merge', {
    previewFingerprint: 'preview-default',
    allowPhotoDeletion: false,
    allowEstimateDiscard: false,
  });
  expect(await screen.findByText('已恢复 12 天训练、0 天饮食记录')).toBeInTheDocument();
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
    '{"schemaVersion":3}',
    'application/json',
  );
  expect(restoreBackup).not.toHaveBeenCalled();
  expect(await screen.findByText(/已发起当前数据备份下载/)).toBeInTheDocument();
  const confirmButton = screen.getByRole('button', { name: '确认覆盖' });
  expect(confirmButton).toBeDisabled();

  await user.click(screen.getByRole('checkbox', { name: '我已确认当前备份文件已保存' }));
  await waitFor(() => expect(confirmButton).toBeEnabled());

  await user.click(confirmButton);

  expect(restoreBackup).toHaveBeenCalledWith(candidate, 'replace', {
    previewFingerprint: 'preview-default',
    allowPhotoDeletion: false,
    allowEstimateDiscard: false,
  });
});

test('冲突照片和未保存候选分别确认后才能恢复', async () => {
  vi.mocked(previewRestore).mockResolvedValue({
    ...candidate.preview,
    fingerprint: 'preview-one',
    mealPhotosToDelete: 2,
    mealEstimatesToDiscard: 1,
  });
  const user = userEvent.setup();
  const { input } = renderPanel();
  await user.upload(input, backupFile());

  const submit = await screen.findByRole('button', { name: '开始安全合并' });
  expect(submit).toBeDisabled();
  expect(await screen.findByText('将删除 2 张仅存本机的餐食缩略图')).toBeInTheDocument();
  expect(screen.getByText('将丢弃 1 份未保存的识别候选')).toBeInTheDocument();

  await user.click(screen.getByRole('checkbox', { name: '我确认删除上述餐食缩略图' }));
  await user.click(screen.getByRole('checkbox', { name: '我确认丢弃上述未保存候选' }));
  await user.click(submit);

  expect(restoreBackup).toHaveBeenCalledWith(candidate, 'merge', {
    previewFingerprint: 'preview-one',
    allowPhotoDeletion: true,
    allowEstimateDiscard: true,
  });
});

test('预览过期后刷新影响范围并要求重新确认', async () => {
  vi.mocked(previewRestore)
    .mockResolvedValueOnce({
      ...candidate.preview,
      fingerprint: 'preview-one',
      mealPhotosToDelete: 1,
      mealEstimatesToDiscard: 0,
    })
    .mockResolvedValueOnce({
      ...candidate.preview,
      fingerprint: 'preview-two',
      mealPhotosToDelete: 2,
      mealEstimatesToDiscard: 0,
    });
  vi.mocked(restoreBackup).mockRejectedValueOnce(
    new BackupImportError('restore-preview-stale', '本机数据在预览后发生变化，请重新确认恢复影响'),
  );
  const user = userEvent.setup();
  const { input } = renderPanel();
  await user.upload(input, backupFile());
  await user.click(await screen.findByRole('checkbox', { name: '我确认删除上述餐食缩略图' }));
  await user.click(screen.getByRole('button', { name: '开始安全合并' }));

  const dialog = screen.getByRole('dialog', { name: '恢复数据' });
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    '本机数据在预览后发生变化，请重新确认恢复影响',
  );
  expect(await screen.findByText('将删除 2 张仅存本机的餐食缩略图')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: '我确认删除上述餐食缩略图' })).not.toBeChecked();
});

test('切换模式会清掉旧预览确认并忽略迟到的旧模式预览', async () => {
  const lateMergePreview = deferred<ModeRestorePreview>();
  vi.mocked(previewRestore).mockImplementation((_candidate, mode) => {
    if (mode === 'merge') return lateMergePreview.promise;
    return Promise.resolve({
      ...candidate.preview,
      fingerprint: 'replace-preview',
      mealPhotosToDelete: 2,
      mealEstimatesToDiscard: 0,
    });
  });
  const user = userEvent.setup();
  const { input } = renderPanel();
  await user.upload(input, backupFile());
  await user.click(await screen.findByRole('radio', { name: /完整覆盖/ }));

  expect(await screen.findByText('将删除 2 张仅存本机的餐食缩略图')).toBeInTheDocument();
  const confirmation = screen.getByRole('checkbox', { name: '我确认删除上述餐食缩略图' });
  expect(confirmation).not.toBeChecked();
  await user.click(confirmation);

  lateMergePreview.resolve({
    ...candidate.preview,
    fingerprint: 'late-merge-preview',
    mealPhotosToDelete: 9,
    mealEstimatesToDiscard: 0,
  });
  await act(async () => lateMergePreview.promise);

  expect(screen.queryByText('将删除 9 张仅存本机的餐食缩略图')).not.toBeInTheDocument();
  expect(screen.getByText('将删除 2 张仅存本机的餐食缩略图')).toBeInTheDocument();
  expect(confirmation).toBeChecked();
});

test('选择另一文件会清掉旧预览和批准', async () => {
  vi.mocked(previewRestore)
    .mockResolvedValueOnce({
      ...candidate.preview,
      fingerprint: 'first-file',
      mealPhotosToDelete: 1,
      mealEstimatesToDiscard: 0,
    })
    .mockResolvedValueOnce({
      ...candidate.preview,
      fingerprint: 'second-file',
      mealPhotosToDelete: 2,
      mealEstimatesToDiscard: 0,
    });
  const user = userEvent.setup();
  const { input } = renderPanel();
  await user.upload(input, backupFile());
  await user.click(await screen.findByRole('checkbox', { name: '我确认删除上述餐食缩略图' }));

  await user.upload(
    input,
    new File(['{}'], 'tiezheng-2026-08-05.json', { type: 'application/json' }),
  );

  expect(await screen.findByText('tiezheng-2026-08-05.json')).toBeInTheDocument();
  expect(await screen.findByText('将删除 2 张仅存本机的餐食缩略图')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: '我确认删除上述餐食缩略图' })).not.toBeChecked();
  expect(screen.getByRole('button', { name: '开始安全合并' })).toBeDisabled();
});

test('恢复失败保留当前预览并允许重试', async () => {
  vi.mocked(restoreBackup)
    .mockRejectedValueOnce(new BackupImportError('restore-failed', '恢复失败，原数据未发生变化'))
    .mockResolvedValueOnce({ workoutDays: 12, nutritionDays: 0 });
  const user = userEvent.setup();
  const { input } = renderPanel();
  await user.upload(input, backupFile());
  const submit = await screen.findByRole('button', { name: '开始安全合并' });
  await waitFor(() => expect(submit).toBeEnabled());

  await user.click(submit);
  const dialog = screen.getByRole('dialog', { name: '恢复数据' });
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('恢复失败，原数据未发生变化');
  await waitFor(() => expect(submit).toBeEnabled());
  await user.click(submit);

  expect(restoreBackup).toHaveBeenCalledTimes(2);
  expect(await screen.findByText('已恢复 12 天训练、0 天饮食记录')).toBeInTheDocument();
});

test('同一事件批次内重复点击只发起一次恢复', async () => {
  const pendingRestore = deferred<{ workoutDays: number; nutritionDays: number }>();
  vi.mocked(restoreBackup).mockReturnValue(pendingRestore.promise);
  const user = userEvent.setup();
  const { input } = renderPanel();
  await user.upload(input, backupFile());
  const submit = await screen.findByRole('button', { name: '开始安全合并' });
  await waitFor(() => expect(submit).toBeEnabled());

  act(() => {
    submit.click();
    submit.click();
  });

  expect(restoreBackup).toHaveBeenCalledOnce();
  pendingRestore.resolve({ workoutDays: 12, nutritionDays: 0 });
  await act(async () => pendingRestore.promise);
});

test('replace 预览过期会撤销本机备份批准并要求重新准备覆盖', async () => {
  vi.mocked(previewRestore)
    .mockResolvedValueOnce({ ...defaultModePreview, fingerprint: 'merge-preview' })
    .mockResolvedValueOnce({ ...defaultModePreview, fingerprint: 'replace-preview-one' })
    .mockResolvedValueOnce({ ...defaultModePreview, fingerprint: 'replace-preview-two' });
  vi.mocked(restoreBackup).mockRejectedValueOnce(
    new BackupImportError('restore-preview-stale', '本机数据在预览后发生变化，请重新确认恢复影响'),
  );
  const user = userEvent.setup();
  const { input } = renderPanel();
  await user.upload(input, backupFile());
  await user.click(await screen.findByRole('radio', { name: /完整覆盖/ }));
  const prepare = await screen.findByRole('button', { name: '准备完整覆盖' });
  await waitFor(() => expect(prepare).toBeEnabled());
  await user.click(prepare);
  await user.click(screen.getByRole('checkbox', { name: '我已确认当前备份文件已保存' }));
  await user.click(screen.getByRole('button', { name: '确认覆盖' }));

  const dialog = screen.getByRole('dialog', { name: '恢复数据' });
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    '本机数据在预览后发生变化，请重新确认恢复影响',
  );
  const prepareAgain = await screen.findByRole('button', { name: '准备完整覆盖' });
  await waitFor(() => expect(prepareAgain).toBeEnabled());
  expect(screen.queryByRole('checkbox', { name: '我已确认当前备份文件已保存' })).not.toBeInTheDocument();
});

test('恢复进行中把焦点留在对话框，Tab 和 Escape 都不会漏到底层', async () => {
  const pendingRestore = deferred<{ workoutDays: number; nutritionDays: number }>();
  vi.mocked(restoreBackup).mockReturnValue(pendingRestore.promise);
  const user = userEvent.setup();
  const { input } = renderPanel();
  await user.upload(input, backupFile());
  const dialog = await screen.findByRole('dialog', { name: '恢复数据' });
  const submit = screen.getByRole('button', { name: '开始安全合并' });
  await waitFor(() => expect(submit).toBeEnabled());

  try {
    await user.click(submit);
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    expect(dialog).toHaveFocus();

    await user.tab();
    expect(dialog).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveFocus();
  } finally {
    pendingRestore.resolve({ workoutDays: 12, nutritionDays: 0 });
    await act(async () => pendingRestore.promise);
  }
});

test('预览计算失败给准确提示并可原地重试', async () => {
  vi.mocked(previewRestore)
    .mockRejectedValueOnce(new Error('preview unavailable'))
    .mockResolvedValueOnce(defaultModePreview);
  const user = userEvent.setup();
  const { input } = renderPanel();
  await user.upload(input, backupFile());
  const dialog = await screen.findByRole('dialog', { name: '恢复数据' });

  expect(await within(dialog).findByRole('alert')).toHaveTextContent('无法计算恢复影响，请重试');
  expect(screen.getByRole('button', { name: '开始安全合并' })).toBeDisabled();
  await user.click(within(dialog).getByRole('button', { name: '重新计算恢复影响' }));

  await waitFor(() => expect(screen.getByRole('button', { name: '开始安全合并' })).toBeEnabled());
  expect(previewRestore).toHaveBeenCalledTimes(2);
  expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
});

test('StrictMode 卸载后迟到的文件解析不会启动预览', async () => {
  const pendingParse = deferred<RestoreCandidate>();
  vi.mocked(parseBackupFile).mockReturnValue(pendingParse.promise);
  const user = userEvent.setup();
  const onRestored = vi.fn();
  const view = render(
    <StrictMode>
      <DataRestorePanel onRestored={onRestored} />
    </StrictMode>,
  );
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;

  await user.upload(input, backupFile());
  view.unmount();
  pendingParse.resolve(candidate);
  await act(async () => pendingParse.promise);

  expect(previewRestore).not.toHaveBeenCalled();
  expect(onRestored).not.toHaveBeenCalled();
});

test('StrictMode 卸载后迟到的恢复结果不会触发回调', async () => {
  const pendingRestore = deferred<{ workoutDays: number; nutritionDays: number }>();
  vi.mocked(restoreBackup).mockReturnValue(pendingRestore.promise);
  const user = userEvent.setup();
  const onRestored = vi.fn();
  const view = render(
    <StrictMode>
      <DataRestorePanel onRestored={onRestored} />
    </StrictMode>,
  );
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, backupFile());
  const submit = await screen.findByRole('button', { name: '开始安全合并' });
  await waitFor(() => expect(submit).toBeEnabled());

  await user.click(submit);
  view.unmount();
  pendingRestore.resolve({ workoutDays: 12, nutritionDays: 0 });
  await act(async () => pendingRestore.promise);

  expect(onRestored).not.toHaveBeenCalled();
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

  const dialog = screen.getByRole('dialog', { name: '恢复数据' });
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('无法保存当前数据，未执行覆盖');
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

test('恢复面板打开时接管焦点，Escape 关闭后归还入口', async () => {
  const user = userEvent.setup();
  const { input } = renderPanel();
  const entry = screen.getByRole('button', { name: '从 JSON 恢复' });
  entry.focus();

  await user.upload(input, backupFile());

  const dialog = await screen.findByRole('dialog', { name: '恢复数据' });
  expect(within(dialog).getByRole('button', { name: '关闭恢复面板' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(entry).toHaveFocus();
});
