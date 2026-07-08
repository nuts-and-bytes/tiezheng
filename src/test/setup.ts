import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

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
