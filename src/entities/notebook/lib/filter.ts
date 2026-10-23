import { useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { Notebook } from '../model/types';

export const NOTEBOOK_FILTER_PARAM = 'notebook';
/** Pseudo-notebook for recordings that are not filed anywhere yet. */
export const INBOX_FILTER = 'inbox';

const NOTEBOOK_COLORS = ['#0e7490', '#c2410c', '#7e22ce', '#047857', '#be123c', '#a16207', '#1d4ed8'];
export const INBOX_COLOR = '#4338ca';

export function getNotebookColor(notebook: Pick<Notebook, 'color'>, index: number) {
  return notebook.color || NOTEBOOK_COLORS[index % NOTEBOOK_COLORS.length];
}

export function matchesNotebookFilter(task: { notebookId?: string | null }, filter: string | null) {
  if (!filter) return true;
  if (filter === INBOX_FILTER) return !task.notebookId;
  return task.notebookId === filter;
}

/**
 * The selected notebook lives in the URL so the sidebar, the list and deep links agree.
 * Changing it keeps the open recording when already on a /notebook route.
 */
export function useNotebookFilter() {
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const filter = searchParams.get(NOTEBOOK_FILTER_PARAM);

  const setFilter = useCallback((next: string | null) => {
    const params = new URLSearchParams(pathname.startsWith('/notebook') ? searchParams : undefined);
    if (next) {
      params.set(NOTEBOOK_FILTER_PARAM, next);
    } else {
      params.delete(NOTEBOOK_FILTER_PARAM);
    }
    const search = params.toString();
    navigate({
      pathname: pathname.startsWith('/notebook') ? pathname : '/notebook',
      search: search ? `?${search}` : '',
    });
  }, [navigate, pathname, searchParams]);

  return [filter, setFilter] as const;
}
