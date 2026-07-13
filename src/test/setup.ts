import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// jsdom 没有 URL.createObjectURL。缺了它，任何要显示照片的组件（PhotoCard / PhotoTimeline）
// 会在 useEffect 里抛错，React 把整棵树拆掉——于是 container 变成空的，而针对
// 「不该出现某个 class」的断言会**假绿**（DOM 里啥都没有，当然找不到）。
if (!URL.createObjectURL) {
  let n = 0;
  URL.createObjectURL = () => `blob:test/${++n}`;
  URL.revokeObjectURL = () => {};
}

// jsdom 没有 matchMedia，InstallHint 等组件需要
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
