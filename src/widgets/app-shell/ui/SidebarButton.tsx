import React from 'react';
import { cn } from '@/shared/lib/cn';

export function SidebarButton({
  active,
  onClick,
  children,
  icon,
  collapsed = false,
  variant = 'default',
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  icon: React.ReactNode;
  collapsed?: boolean;
  variant?: 'default' | 'danger';
}) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? (typeof children === 'string' ? children : undefined) : undefined}
      className={cn(
        'w-full flex items-center rounded-xl text-sm font-medium transition-all duration-200',
        collapsed ? 'justify-center px-0 py-3' : 'gap-3 px-4 py-3',
        variant === 'danger'
          ? 'text-red-600 hover:bg-red-50'
          : active
            ? 'bg-indigo-50 text-indigo-700 shadow-sm'
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100',
      )}
    >
      <span className="shrink-0">{icon}</span>
      {!collapsed && children}
    </button>
  );
}
