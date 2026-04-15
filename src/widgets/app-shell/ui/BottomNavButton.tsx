import React from 'react';
import { cn } from '@/shared/lib/cn';

export function BottomNavButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center w-16 h-12 gap-1 transition-colors',
        active ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600',
      )}
    >
      {icon}
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}
