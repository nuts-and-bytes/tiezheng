const KEY = 'tiezheng-log';
const MAX = 100;

/** 本地环形日志（规格 §12）：容量 100 条，写入永不抛错 */
export function log(msg: string): void {
  try {
    const logs = readLogs();
    logs.push(`${new Date().toISOString()} ${msg}`);
    localStorage.setItem(KEY, JSON.stringify(logs.slice(-MAX)));
  } catch {
    // 日志失败不影响主流程
  }
}

export function readLogs(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
