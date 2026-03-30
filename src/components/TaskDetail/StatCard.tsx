import React from 'react';

export function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center gap-2 text-slate-500 text-sm">
        {icon}
        {label}
      </div>
      <p className="text-lg font-semibold text-slate-900 mt-2">{value}</p>
    </div>
  );
}
