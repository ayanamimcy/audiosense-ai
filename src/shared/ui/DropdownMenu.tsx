import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/shared/lib/cn';

export interface DropdownMenuItem {
  key: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Draws a divider above this item. */
  separated?: boolean;
}

const MENU_GAP = 6;
const VIEWPORT_MARGIN = 8;

/**
 * Minimal click-to-open menu. `trigger` receives the toggle handler and open state
 * so callers keep full control over the button markup. The menu is portalled with
 * fixed positioning so scrolling/overflow containers (sidebar lists) never clip it.
 */
export function DropdownMenu({
  trigger,
  items,
  align = 'right',
  placement = 'bottom',
  className,
}: {
  trigger: (props: { onClick: () => void; open: boolean }) => React.ReactNode;
  items: DropdownMenuItem[];
  align?: 'left' | 'right';
  placement?: 'bottom' | 'top';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<React.CSSProperties | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setPosition(null);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = rootRef.current?.getBoundingClientRect();
    const menu = menuRef.current?.getBoundingClientRect();
    if (!anchor || !menu) return;

    const fitsBelow = anchor.bottom + MENU_GAP + menu.height <= window.innerHeight - VIEWPORT_MARGIN;
    const fitsAbove = anchor.top - MENU_GAP - menu.height >= VIEWPORT_MARGIN;
    const placeBelow = placement === 'bottom' ? fitsBelow || !fitsAbove : !fitsAbove && fitsBelow;
    const top = placeBelow ? anchor.bottom + MENU_GAP : anchor.top - MENU_GAP - menu.height;

    const preferredLeft = align === 'right' ? anchor.right - menu.width : anchor.left;
    const left = Math.min(
      Math.max(preferredLeft, VIEWPORT_MARGIN),
      window.innerWidth - menu.width - VIEWPORT_MARGIN,
    );

    setPosition({ top: Math.max(top, VIEWPORT_MARGIN), left });
  }, [open, align, placement, items.length]);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (rootRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const handleScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      close();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, close]);

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      {trigger({ onClick: () => (open ? close() : setOpen(true)), open })}
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={position ?? { top: 0, left: 0, visibility: 'hidden' }}
              className="fixed z-[60] max-h-[min(24rem,calc(100dvh-1rem))] min-w-[200px] max-w-[280px] overflow-y-auto rounded-xl border border-stone-200 bg-white p-1.5 shadow-[0_12px_32px_rgba(28,25,23,0.12)]"
            >
              {items.map((item) => (
                <React.Fragment key={item.key}>
                  {item.separated ? <div className="my-1 h-px bg-stone-200" /> : null}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => {
                      close();
                      item.onSelect();
                    }}
                    className={cn(
                      'flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                      item.danger ? 'text-red-700 hover:bg-red-50' : 'text-stone-800 hover:bg-stone-100',
                    )}
                  >
                    {item.icon ? (
                      <span className={cn('shrink-0', item.danger ? 'text-red-600' : 'text-stone-500')}>{item.icon}</span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </button>
                </React.Fragment>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
