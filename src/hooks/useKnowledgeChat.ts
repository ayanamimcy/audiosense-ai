import { useCallback, useRef, useState } from 'react';
import { apiJson, apiFetch } from '../api';
import { consumeSseStream } from './useSseStream';
import type {
  KnowledgeConversation,
  KnowledgeMessage,
  KnowledgeMessageMetadata,
  MentionRef,
} from '../types';

export function useKnowledgeChat() {
  const [conversations, setConversations] = useState<KnowledgeConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<KnowledgeMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const loadConversations = useCallback(async () => {
    setIsLoadingConversations(true);
    try {
      const result = await apiJson<KnowledgeConversation[]>('/api/knowledge/conversations');
      setConversations(result);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    } finally {
      setIsLoadingConversations(false);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string): Promise<KnowledgeMessage[]> => {
    setIsLoadingMessages(true);
    try {
      const result = await apiJson<{
        conversation: KnowledgeConversation;
        messages: KnowledgeMessage[];
      }>(`/api/knowledge/conversations/${conversationId}/messages`);
      setMessages(result.messages);
      setActiveConversationId(conversationId);
      return result.messages;
    } catch (error) {
      console.error('Failed to load messages:', error);
      return [];
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  const startNewConversation = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
  }, []);

  const deleteConversation = useCallback(async (conversationId: string) => {
    try {
      await apiFetch(`/api/knowledge/conversations/${conversationId}`, { method: 'DELETE' });
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      if (activeConversationId === conversationId) {
        setActiveConversationId(null);
        setMessages([]);
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  }, [activeConversationId]);

  const renameConversation = useCallback(async (conversationId: string, title: string) => {
    try {
      await apiFetch(`/api/knowledge/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      setConversations((prev) =>
        prev.map((c) => c.id === conversationId ? { ...c, title } : c),
      );
    } catch (error) {
      console.error('Failed to rename conversation:', error);
    }
  }, []);

  const sendMessage = useCallback(async (content: string, mentions: MentionRef[]) => {
    if (!content.trim() || isStreaming) return;

    const userMessage: KnowledgeMessage = {
      id: `temp-user-${Date.now()}`,
      conversationId: activeConversationId || '',
      role: 'user',
      content,
      mentions,
      metadata: null,
      createdAt: Date.now(),
    };

    const pendingAssistant: KnowledgeMessage = {
      id: `temp-assistant-${Date.now()}`,
      conversationId: activeConversationId || '',
      role: 'assistant',
      content: '',
      mentions: [],
      metadata: null,
      createdAt: Date.now(),
      pending: true,
    };

    setMessages((prev) => [...prev, userMessage, pendingAssistant]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await apiFetch('/api/knowledge/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: activeConversationId,
          message: content,
          mentions,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(err?.error || `Request failed with status ${response.status}`);
      }

      let streamedContent = '';

      await consumeSseStream(response, {
        onDelta: (payload) => {
          const text = typeof payload === 'object' ? payload.text : String(payload);
          streamedContent += text;
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].pending) {
              updated[lastIdx] = { ...updated[lastIdx], content: streamedContent };
            }
            return updated;
          });
        },
        onDone: (payload) => {
          const metadata: KnowledgeMessageMetadata = {
            sources: payload.sources,
            retrieval: payload.retrieval,
          };

          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].pending) {
              updated[lastIdx] = {
                ...updated[lastIdx],
                id: payload.messageId || updated[lastIdx].id,
                conversationId: payload.conversationId || updated[lastIdx].conversationId,
                content: streamedContent || updated[lastIdx].content,
                metadata,
                pending: false,
              };
              // Also update user message conversationId for new conversations
              if (payload.conversationId && lastIdx > 0) {
                updated[lastIdx - 1] = {
                  ...updated[lastIdx - 1],
                  conversationId: payload.conversationId,
                };
              }
            }
            return updated;
          });

          if (payload.conversationId) {
            setActiveConversationId(payload.conversationId);
            void loadConversations();
          }
        },
        onError: (payload) => {
          const errorMsg = typeof payload === 'object' ? payload.error : String(payload);
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].pending) {
              updated[lastIdx] = {
                ...updated[lastIdx],
                content: errorMsg || 'An error occurred.',
                pending: false,
                error: true,
              };
            }
            return updated;
          });
        },
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].pending) {
          updated[lastIdx] = {
            ...updated[lastIdx],
            content: error instanceof Error ? error.message : 'Failed to send message.',
            pending: false,
            error: true,
          };
        }
        return updated;
      });
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [activeConversationId, isStreaming, loadConversations]);

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    conversations,
    activeConversationId,
    messages,
    isStreaming,
    isLoadingConversations,
    isLoadingMessages,
    loadConversations,
    loadMessages,
    startNewConversation,
    deleteConversation,
    renameConversation,
    sendMessage,
    cancelStream,
  };
}
