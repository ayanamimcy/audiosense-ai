import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

/**
 * Centered modal on desktop, bottom sheet on mobile.
 * `onClose` is called for Escape, backdrop clicks and the close button —
 * callers that need to block closing (e.g. an upload in progress) decide inside it.
 */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  className,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 sm:items-start sm:p-4 sm:pt-[10vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl',
          className,
        )}
      >
        <div className="flex shrink-0 items-center gap-3 px-5 pt-4 pb-2">
          <h2 className="flex-1 text-lg font-semibold text-stone-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-5 pb-5">{children}</div>
        {footer ? (
          <div className="flex shrink-0 items-center gap-2 border-t border-stone-200 bg-stone-50 px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
