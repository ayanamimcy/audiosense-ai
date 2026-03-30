import { useState } from 'react';
import { apiJson } from '../api';
import type { Notebook, SummaryPrompt, TagStat } from '../types';

export function useLibraryData() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [tags, setTags] = useState<TagStat[]>([]);
  const [summaryPrompts, setSummaryPrompts] = useState<SummaryPrompt[]>([]);

  const fetchNotebooks = async () => {
    setNotebooks(await apiJson<Notebook[]>('/api/notebooks'));
  };

  const fetchTags = async () => {
    setTags(await apiJson<TagStat[]>('/api/tags'));
  };

  const fetchSummaryPrompts = async () => {
    setSummaryPrompts(await apiJson<SummaryPrompt[]>('/api/summary-prompts'));
  };

  const clearLibraryData = () => {
    setNotebooks([]);
    setTags([]);
    setSummaryPrompts([]);
  };

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
