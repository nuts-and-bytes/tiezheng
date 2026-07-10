import { useLogDraft } from './logDraftStore';

beforeEach(() => {
  useLogDraft.setState({ active: false, parts: [], items: [] });
  localStorage.clear();
});

test('start 开启草稿；已激活时不清空已有内容', () => {
  useLogDraft.getState().start();
  useLogDraft.getState().togglePart('chest');
  useLogDraft.getState().start();
  expect(useLogDraft.getState().parts).toEqual(['chest']);
});

test('togglePart 选中/取消', () => {
  const s = useLogDraft.getState();
  s.togglePart('chest');
  s.togglePart('leg');
  s.togglePart('chest');
  expect(useLogDraft.getState().parts).toEqual(['leg']);
});

test('addItem 去重、默认 3 空组；removeItemByExercise 移除', () => {
  const s = useLogDraft.getState();
  s.addItem('p-bench');
  s.addItem('p-bench');
  expect(useLogDraft.getState().items).toHaveLength(1);
  expect(useLogDraft.getState().items[0].sets).toEqual([{}, {}, {}]);
  s.removeItemByExercise('p-bench');
  expect(useLogDraft.getState().items).toHaveLength(0);
});

test('updateSets 按下标更新；reset 清空', () => {
  const s = useLogDraft.getState();
  s.addItem('p-bench');
  s.updateSets(0, [{ weight: 60, reps: 10 }]);
  expect(useLogDraft.getState().items[0].sets).toEqual([{ weight: 60, reps: 10 }]);
  s.reset();
  expect(useLogDraft.getState()).toMatchObject({ active: false, parts: [], items: [] });
});
