import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

export const inputClassName =
  'h-10 w-full rounded-lg border border-stone-200 bg-white px-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10 disabled:bg-stone-50 disabled:text-stone-500';

export const primaryButtonClassName =
  'inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50';

export const secondaryButtonClassName =
  'inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-stone-200 bg-white px-3.5 text-sm font-medium text-stone-900 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50';

export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-sm font-medium text-stone-800">{label}</span>
      {children}
      {hint ? <span className="text-xs text-stone-500">{hint}</span> : null}
    </label>
  );
}

/** A labelled on/off switch row; renders a native checkbox with role="switch". */
export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-4 border-b border-stone-200 py-3.5 last:border-b-0">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-stone-900">{label}</span>
        {description ? <span className="mt-0.5 block text-[13px] text-stone-600">{description}</span> : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="relative h-6 w-10 shrink-0 rounded-full bg-stone-300 transition-colors after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-stone-900 peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-stone-900/30 peer-disabled:opacity-50"
      />
    </label>
  );
}

export function SectionHeading({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-[22px] font-semibold tracking-tight text-stone-900">{title}</h2>
      {description ? <p className="mt-1 text-sm text-stone-600">{description}</p> : null}
    </div>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="mt-8 mb-2 text-sm font-semibold text-stone-900 first:mt-0">{children}</h3>;
}
