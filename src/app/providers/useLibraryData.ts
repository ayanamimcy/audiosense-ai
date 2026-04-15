import { useCallback, useState } from 'react';
import { apiJson } from '@/shared/api/base';
import type { Notebook } from '@/entities/notebook';
import type { TagStat } from '@/entities/tag';
import type { SummaryPrompt } from '@/entities/summary-prompt';

export function useLibraryData() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [tags, setTags] = useState<TagStat[]>([]);
  const [summaryPrompts, setSummaryPrompts] = useState<SummaryPrompt[]>([]);

  const fetchNotebooks = useCallback(async () => {
    setNotebooks(await apiJson<Notebook[]>('/api/notebooks'));
  }, []);

  const fetchTags = useCallback(async () => {
    setTags(await apiJson<TagStat[]>('/api/tags'));
  }, []);

  const fetchSummaryPrompts = useCallback(async () => {
    setSummaryPrompts(await apiJson<SummaryPrompt[]>('/api/summary-prompts'));
  }, []);

  const clearLibraryData = useCallback(() => {
    setNotebooks([]);
    setTags([]);
    setSummaryPrompts([]);
  }, []);

  return {
    notebooks,
    tags,
    summaryPrompts,
    fetchNotebooks,
    fetchTags,
    fetchSummaryPrompts,
    clearLibraryData,
  };
}
