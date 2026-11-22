import { Drawer as DrawerPrimitive } from '@base-ui/react/drawer';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type RefObject,
  type TouchEvent,
} from 'react';

export type DrawerPosition = 'bottom' | 'top' | 'left' | 'right';

interface DrawerContextValue {
  position: DrawerPosition;
}

const DrawerContext = createContext<DrawerContextValue>({
  position: 'bottom',
});

const DIRECTION_MAP: Record<
  DrawerPosition,
  NonNullable<DrawerPrimitive.Root.Props['swipeDirection']>
> = {
  bottom: 'down',
  top: 'up',
  left: 'left',
  right: 'right',
};

const FOCUSABLE_SELECTOR = [
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'a[href]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function mergeBaseClassName<State>(
  base: string,
  className: string | ((state: State) => string | undefined) | undefined,
): string | ((state: State) => string | undefined) {
  if (typeof className === 'function') {
    return (state: State) => joinClasses(base, className(state));
  }
  return joinClasses(base, className);
}

function isVisibleFocusable(node: HTMLElement, root: HTMLElement): boolean {
  if (
    node.tabIndex < 0 ||
    node.matches(':disabled') ||
    node.getAttribute('aria-disabled') === 'true'
  ) {
    return false;
  }

  let current: HTMLElement | null = node;
  while (current && root.contains(current)) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true') {
      return false;
    }
    const style = window.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
    if (current === root) break;
    current = current.parentElement;
  }
  return true;
}

function assignRef<T>(
  ref: React.Ref<T> | undefined,
  value: T | null,
): void {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref && 'current' in ref) {
    (ref as React.MutableRefObject<T | null>).current = value;
  }
}

export type DrawerProps = DrawerPrimitive.Root.Props & {
  position?: DrawerPosition;
};

/**
 * Coss UI Drawer (https://coss.com/ui/docs/components/drawer) adapted to IRONPROOF
 * forged-metal theme tokens and built on @base-ui/react/drawer.
 */
export function Drawer({
  position = 'bottom',
  swipeDirection,
  ...props
}: DrawerProps) {
  return (
    <DrawerContext.Provider value={{ position }}>
      <DrawerPrimitive.Root
        swipeDirection={swipeDirection ?? DIRECTION_MAP[position]}
        {...props}
      />
    </DrawerContext.Provider>
  );
}

export const DrawerPortal = DrawerPrimitive.Portal;
export const DrawerTrigger = DrawerPrimitive.Trigger;
export const DrawerClose = DrawerPrimitive.Close;
export const DrawerContent = DrawerPrimitive.Content;
export const DrawerDescription = DrawerPrimitive.Description;

export function DrawerBackdrop({
  className,
  ...props
}: DrawerPrimitive.Backdrop.Props) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="drawer-backdrop"
      className={mergeBaseClassName(
        'fixed inset-0 z-[60] bg-black/75 opacity-[calc(1-var(--drawer-swipe-progress,0))] backdrop-blur-[2px] transition-opacity duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[swiping]:duration-0 motion-reduce:transition-none',
        className,
      )}
      {...props}
    />
  );
}

export function DrawerViewport({
  className,
  position: positionProp,
  ...props
}: DrawerPrimitive.Viewport.Props & { position?: DrawerPosition }) {
  const { position: contextPosition } = useContext(DrawerContext);
  const position = positionProp ?? contextPosition;

  return (
    <DrawerPrimitive.Viewport
      data-slot="drawer-viewport"
      className={mergeBaseClassName(
        joinClasses(
          'fixed inset-0 z-[60] touch-none',
          position === 'bottom' &&
            'grid grid-rows-[1fr_auto] items-end justify-items-center pt-[max(12px,env(safe-area-inset-top,0px))]',
          position === 'top' && 'grid grid-rows-[auto_1fr] items-start justify-items-center pb-12',
          position === 'left' && 'flex justify-start',
          position === 'right' && 'flex justify-end',
        ),
        className,
      )}
      {...props}
    />
  );
}

export function DrawerBar({
  locked = false,
  className,
  onLockedDragAttempt,
}: {
  locked?: boolean;
  className?: string;
  onLockedDragAttempt?: () => void;
}) {
  const startYRef = useRef<number | null>(null);

  function startTrack(clientY: number) {
    if (!locked) return;
    startYRef.current = clientY;
  }

  function moveTrack(clientY: number) {
    if (!locked || startYRef.current === null) return;
    if (clientY - startYRef.current > 18) {
      startYRef.current = null;
      onLockedDragAttempt?.();
    }
  }

  function resetTrack() {
    startYRef.current = null;
  }

  return (
    <div
      data-slot="drawer-bar"
      data-swipe-locked={locked ? 'true' : undefined}
      aria-hidden="true"
      onPointerDown={(event) => {
        if (locked) {
          event.stopPropagation();
          startTrack(event.clientY);
        }
      }}
      onPointerMove={(event) => moveTrack(event.clientY)}
      onPointerUp={resetTrack}
      onPointerCancel={resetTrack}
      onTouchStart={(event) => {
        if (locked) {
          event.stopPropagation();
          if (event.touches[0]) startTrack(event.touches[0].clientY);
        }
      }}
      onTouchMove={(event) => {
        if (event.touches[0]) moveTrack(event.touches[0].clientY);
      }}
      onTouchEnd={resetTrack}
      onTouchCancel={resetTrack}
      className={joinClasses(
        'flex shrink-0 touch-none items-center justify-center pb-1 pt-3',
        locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing',
        className,
      )}
    >
      <span
        className={joinClasses(
          'block h-1 w-11 rounded-full transition-colors motion-reduce:transition-none',
          locked ? 'bg-amber/35' : 'bg-white/25',
        )}
      />
    </div>
  );
}

export interface DrawerPopupProps extends DrawerPrimitive.Popup.Props {
  position?: DrawerPosition;
  showBar?: boolean;
  swipeLocked?: boolean;
  onLockedSwipeAttempt?: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  popupRef?: React.Ref<HTMLDivElement>;
  portalProps?: DrawerPrimitive.Portal.Props;
}

export function DrawerPopup({
  className,
  children,
  position: positionProp,
  showBar = true,
  swipeLocked = false,
  onLockedSwipeAttempt,
  initialFocusRef,
  popupRef,
  portalProps,
  onPointerDown,
  onTouchStart,
  ...props
}: DrawerPopupProps) {
  const { position: contextPosition } = useContext(DrawerContext);
  const position = positionProp ?? contextPosition;
  const [popupEl, setPopupEl] = useState<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const openerCapturedRef = useRef(false);
  if (!openerCapturedRef.current && typeof document !== 'undefined') {
    openerCapturedRef.current = true;
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  const lockedTouchStartY = useRef<number | null>(null);

  const setCombinedRef = useCallback(
    (node: HTMLDivElement | null) => {
      setPopupEl(node);
      assignRef(popupRef, node);
    },
    [popupRef],
  );

  // Sync body scroll-lock and opener focus restoration even when parents conditionally unmount.
  useLayoutEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      const opener = openerRef.current;
      if (opener && opener.isConnected) {
        opener.focus();
      }
    };
  }, []);

  // Sync initial focus and Tab ring fallback (for jsdom & older webviews).
  useEffect(() => {
    const dialog = popupEl;
    if (!dialog) return;

    const getControls = () =>
      [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((node) =>
        isVisibleFocusable(node, dialog),
      );

    const target = initialFocusRef?.current ?? getControls()[0];
    if (target && document.activeElement !== target) {
      target.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const nodes = getControls();
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

    dialog.addEventListener('keydown', handleKeyDown);
    return () => {
      dialog.removeEventListener('keydown', handleKeyDown);
    };
  }, [popupEl, initialFocusRef]);

  const handlePointerDown: NonNullable<DrawerPrimitive.Popup.Props['onPointerDown']> = (
    event,
  ) => {
    onPointerDown?.(event);
    if (swipeLocked) {
      // Stop pointer bubbling to DrawerViewport so swipe-to-dismiss never initiates while editing.
      event.stopPropagation();
    }
  };

  const handleTouchStart: NonNullable<DrawerPrimitive.Popup.Props['onTouchStart']> = (
    event,
  ) => {
    onTouchStart?.(event);
    if (swipeLocked) {
      event.stopPropagation();
      lockedTouchStartY.current = event.touches[0]?.clientY ?? null;
    }
  };

  function handleTouchMove(event: TouchEvent<HTMLDivElement>) {
    if (!swipeLocked || lockedTouchStartY.current === null) return;
    const target = event.target as HTMLElement | null;
    const scrollable = target?.closest('[data-slot="drawer-panel"]');
    const atTop = !scrollable || scrollable.scrollTop <= 0;
    const deltaY = (event.touches[0]?.clientY ?? lockedTouchStartY.current) - lockedTouchStartY.current;
    if (atTop && deltaY > 28) {
      lockedTouchStartY.current = null;
      onLockedSwipeAttempt?.();
    }
  }

  function handleTouchEnd() {
    lockedTouchStartY.current = null;
  }

  const popup = (
    <DrawerPortal {...portalProps}>
      <DrawerBackdrop />
      <DrawerViewport position={position}>
        <DrawerPrimitive.Popup
          ref={setCombinedRef}
          data-slot="drawer-popup"
          data-swipe-locked={swipeLocked ? 'true' : undefined}
          aria-modal="true"
          initialFocus={initialFocusRef ?? true}
          onPointerDown={handlePointerDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          className={mergeBaseClassName(
            joinClasses(
              'forged-surface relative flex max-h-[90dvh] min-h-0 w-full max-w-md touch-none flex-col overflow-hidden rounded-t-3xl border-x-0 border-b-0 text-ink outline-none will-change-transform transition-[transform,box-shadow,height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none',
              position === 'bottom' &&
                'row-start-2 transform-[translateY(calc(var(--keyboard-snap-offset,0px)+var(--drawer-swipe-movement-y,0px)))] pb-[max(0px,var(--drawer-keyboard-inset,0px))] data-[starting-style]:transform-[translateY(calc(100%+env(safe-area-inset-bottom,0px)))] data-[ending-style]:transform-[translateY(calc(100%+env(safe-area-inset-bottom,0px)))] data-[swiping]:duration-0 data-[swiping]:select-none',
            ),
            className,
          )}
          {...props}
        >
          {showBar && (
            <DrawerBar
              locked={swipeLocked}
              onLockedDragAttempt={onLockedSwipeAttempt}
            />
          )}
          {children}
        </DrawerPrimitive.Popup>
      </DrawerViewport>
    </DrawerPortal>
  );

  return position === 'bottom' ? (
    <DrawerPrimitive.VirtualKeyboardProvider>
      {popup}
    </DrawerPrimitive.VirtualKeyboardProvider>
  ) : (
    popup
  );
}

export function DrawerHeader({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      data-slot="drawer-header"
      className={joinClasses('shrink-0 px-5 pt-2', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function DrawerTitle({
  className,
  ...props
}: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={mergeBaseClassName('text-lg font-extrabold text-ink', className)}
      {...props}
    />
  );
}

export function DrawerPanel({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<'div'>) {
  return (
    <DrawerPrimitive.Content
      data-slot="drawer-panel"
      className={joinClasses(
        'min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y px-5 py-4',
        className,
      )}
      {...props}
    >
      {children}
    </DrawerPrimitive.Content>
  );
}

export function DrawerFooter({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<'div'> & { children: ReactNode }) {
  return (
    <DrawerPrimitive.Content
      data-slot="drawer-footer"
      className={joinClasses(
        'shrink-0 border-t border-line bg-raised/95 px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom,0px))]',
        className,
      )}
      {...props}
    >
      {children}
    </DrawerPrimitive.Content>
  );
}

export { DrawerPrimitive };
