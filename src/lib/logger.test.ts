import { log, readLogs } from './logger';

beforeEach(() => localStorage.clear());

test('log 追加一条带时间戳的记录', () => {
  log('something broke');
  const logs = readLogs();
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatch(/^\d{4}-\d{2}-\d{2}T.*something broke$/);
});

test('环形上限 100 条，旧的被挤出', () => {
  for (let i = 0; i < 105; i++) log(`msg-${i}`);
  const logs = readLogs();
  expect(logs).toHaveLength(100);
  expect(logs[0]).toContain('msg-5');
  expect(logs[99]).toContain('msg-104');
});

test('localStorage 损坏时 readLogs 返回空数组', () => {
  localStorage.setItem('tiezheng-log', '{not json');
  expect(readLogs()).toEqual([]);
});
