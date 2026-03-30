import React from 'react';
import { cn } from '../../lib/utils';

export function PanelButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-2 border transition-colors',
        active
          ? 'bg-white text-indigo-700 border-indigo-200 shadow-sm'
          : 'text-slate-600 border-transparent hover:bg-slate-100 hover:border-slate-200',
      )}
    >
      {icon}
      {children}
    </button>
  );
}
