import React from 'react';
import { ChevronRight } from 'lucide-react';

export function DrawerButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between p-4 bg-white border border-slate-100 rounded-xl hover:bg-slate-50 transition-colors active:scale-[0.98]"
    >
      <div className="flex items-center gap-3">
        <div className="p-2 bg-slate-50 rounded-lg">{icon}</div>
        <span className="font-medium text-slate-700">{label}</span>
      </div>
      <ChevronRight className="w-5 h-5 text-slate-300" />
    </button>
  );
}
