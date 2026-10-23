import { Check, ChevronDown, ChevronsUpDown, Settings2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/shared/lib/cn';
import { DropdownMenu } from '@/shared/ui/DropdownMenu';
import { useAppDataContext } from '@/app/providers/app-data-context';

export function WorkspaceSwitcher({
  variant,
  onSwitch,
}: {
  /** `rail`: compact block in the desktop sidebar. `title`: large page title on mobile. */
  variant: 'rail' | 'title';
  onSwitch: (workspaceId: string) => void;
}) {
  const navigate = useNavigate();
  const { workspaces, currentWorkspace, currentWorkspaceId } = useAppDataContext();
  const name = currentWorkspace?.name || 'Workspace';

  return (
    <DropdownMenu
      align="left"
      items={[
        ...workspaces.map((workspace) => ({
          key: workspace.id,
          label: workspace.name,
          icon: workspace.id === currentWorkspaceId
            ? <Check className="h-4 w-4 text-stone-900" />
            : <span className="block h-4 w-4" />,
          onSelect: () => onSwitch(workspace.id),
        })),
        {
          key: 'manage',
          label: 'Manage workspaces',
          icon: <Settings2 className="h-4 w-4" />,
          separated: true,
          onSelect: () => navigate('/settings?section=workspaces'),
        },
      ]}
      trigger={({ onClick, open }) => (
        variant === 'rail' ? (
          <button
            type="button"
            onClick={onClick}
            aria-expanded={open}
            className="flex min-h-11 w-full items-center gap-2.5 rounded-xl p-2 text-left hover:bg-stone-200/50"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-stone-900 text-[13px] font-semibold text-white">
              {name.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-stone-900">{name}</span>
              <span className="block text-xs text-stone-500">Workspace</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-stone-500" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onClick}
            aria-expanded={open}
            className="flex min-h-11 min-w-0 items-center gap-1.5 text-left"
          >
            <span className="truncate text-[22px] font-bold tracking-tight text-stone-900">{name}</span>
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-stone-600 transition-transform', open && 'rotate-180')} />
          </button>
        )
      )}
    />
  );
}
