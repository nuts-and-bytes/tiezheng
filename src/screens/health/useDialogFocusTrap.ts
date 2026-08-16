import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'a[href]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function isVisibleControl(node: HTMLElement, dialog: HTMLElement): boolean {
  if (node.tabIndex < 0 || node.matches(':disabled') || node.getAttribute('aria-disabled') === 'true') {
    return false;
  }

  let current: HTMLElement | null = node;
  while (current && dialog.contains(current)) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (current === dialog) break;
    current = current.parentElement;
  }
  return true;
}

export function useDialogFocusTrap(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const controls = () =>
      [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) =>
        isVisibleControl(node, dialog),
      );

    controls()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const nodes = controls();
      if (nodes.length === 0) {
        event.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener('keydown', keydown);
    return () => {
      dialog.removeEventListener('keydown', keydown);
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, [ref]);
}
