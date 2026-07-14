/**
 * 触发浏览器把一个 Blob 存到本地。全仓库唯一的下载出口。
 *
 * iOS Safari（尤其 PWA 独立模式）：<a> 必须挂载到 DOM 才能可靠触发下载 / 系统面板，
 * 游离节点上的 click() 会被静默丢弃；revokeObjectURL 若与 click() 同步执行，
 * 部分机型会在下载真正发起前吊销 blob URL，用户拿到空文件。
 * 这两条教训曾经只写在导出数据那一份实现里，海报下载因此断了——所以合并成一处。
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
