import { useCallback, useRef, useState } from 'react';
import { apiJson } from '../api';
import type { MentionCandidate, MentionRef } from '../types';

interface MentionCandidatesResponse {
  notebooks: MentionCandidate[];
  tasks: MentionCandidate[];
}

export function useMentions() {
  const [candidates, setCandidates] = useState<MentionCandidate[]>([]);
  const [selectedMentions, setSelectedMentions] = useState<MentionRef[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const searchCandidates = useCallback(async (query: string) => {
    setIsLoading(true);
    try {
      const result = await apiJson<MentionCandidatesResponse>(
        `/api/knowledge/mentions?q=${encodeURIComponent(query)}`,
      );
      setCandidates([...result.notebooks, ...result.tasks]);
    } catch (error) {
      console.error('Failed to load mention candidates:', error);
      setCandidates([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const openMentionMenu = useCallback((query = '') => {
    setIsOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void searchCandidates(query);
    }, 150);
  }, [searchCandidates]);

  const closeMentionMenu = useCallback(() => {
    setIsOpen(false);
    setCandidates([]);
  }, []);

  const selectMention = useCallback((candidate: MentionCandidate) => {
    const ref: MentionRef = {
      type: candidate.type,
      id: candidate.id,
      name: candidate.name,
    };
    setSelectedMentions((prev) => {
      if (prev.some((m) => m.id === ref.id && m.type === ref.type)) return prev;
      return [...prev, ref];
    });
    setIsOpen(false);
  }, []);

  const removeMention = useCallback((id: string) => {
    setSelectedMentions((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const clearMentions = useCallback(() => {
    setSelectedMentions([]);
  }, []);

  const restoreMentions = useCallback((mentions: MentionRef[]) => {
    const unique = new Map<string, MentionRef>();
    for (const m of mentions) {
      unique.set(`${m.type}-${m.id}`, m);
    }
    setSelectedMentions([...unique.values()]);
  }, []);

  return {
    candidates,
    selectedMentions,
    isLoading,
    isOpen,
    openMentionMenu,
    closeMentionMenu,
    selectMention,
    removeMention,
    clearMentions,
    restoreMentions,
  };
}
