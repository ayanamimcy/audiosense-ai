import { useCallback, useRef, useState } from 'react';
import { apiJson, apiFetch } from '@/shared/api/base';
import { consumeSseStream } from '@/shared/lib/sse-stream';
import type {
  KnowledgeConversation,
  KnowledgeMessage,
  KnowledgeMessageMetadata,
  MentionRef,
} from '@/entities/knowledge';

export function useKnowledgeChat() {
  const [conversations, setConversations] = useState<KnowledgeConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<KnowledgeMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Bumped whenever the visible conversation changes. A reply streaming for a conversation
  // the user has left keeps running (the server saves it) but stops writing into the view.
  const viewRef = useRef(0);

  const detachStream = useCallback(() => {
    viewRef.current += 1;
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

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
    detachStream();
    const view = viewRef.current;
    setIsLoadingMessages(true);
    try {
      const result = await apiJson<{
        conversation: KnowledgeConversation;
        messages: KnowledgeMessage[];
      }>(`/api/knowledge/conversations/${conversationId}/messages`);
      // A later click (another conversation, New) wins over this slower response.
      if (view !== viewRef.current) return [];
      setMessages(result.messages);
      setActiveConversationId(conversationId);
      return result.messages;
    } catch (error) {
      console.error('Failed to load messages:', error);
      return [];
    } finally {
      if (view === viewRef.current) setIsLoadingMessages(false);
    }
  }, [detachStream]);

  const startNewConversation = useCallback(() => {
    detachStream();
    setIsLoadingMessages(false);
    setActiveConversationId(null);
    setMessages([]);
  }, [detachStream]);

  const deleteConversation = useCallback(async (conversationId: string) => {
    try {
      await apiFetch(`/api/knowledge/conversations/${conversationId}`, { method: 'DELETE' });
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      if (activeConversationId === conversationId) {
        detachStream();
        setActiveConversationId(null);
        setMessages([]);
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  }, [activeConversationId, detachStream]);

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

    const view = viewRef.current;
    const isViewActive = () => view === viewRef.current;
    const updatePendingAssistant = (patch: (message: KnowledgeMessage) => KnowledgeMessage) => {
      if (!isViewActive()) return;
      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].pending) {
          updated[lastIdx] = patch(updated[lastIdx]);
        }
        return updated;
      });
    };

    setMessages((prev) => [...prev, userMessage, pendingAssistant]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let streamedContent = '';

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

      await consumeSseStream(response, {
        onDelta: (payload) => {
          const text = typeof payload === 'object' ? payload?.text : String(payload);
          if (typeof text !== 'string' || !text) return;
          streamedContent += text;
          updatePendingAssistant((message) => ({ ...message, content: streamedContent }));
        },
        onDone: (payload) => {
          const metadata: KnowledgeMessageMetadata = {
            sources: payload.sources,
            retrieval: payload.retrieval,
          };

          // Refresh the list either way: a new conversation may have been created server-side.
          void loadConversations();
          if (!isViewActive()) return;

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
          }
        },
        onError: (payload) => {
          const errorMsg = typeof payload === 'object' ? payload?.error : String(payload);
          updatePendingAssistant((message) => ({
            ...message,
            content: errorMsg || 'An error occurred.',
            pending: false,
            error: true,
          }));
        },
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // Stopped by the user: keep what was streamed. The server saves the question but
        // not a stopped answer, so refresh the list in case this started a conversation.
        updatePendingAssistant((message) => ({
          ...message,
          content: streamedContent || 'Stopped.',
          pending: false,
        }));
        void loadConversations();
        return;
      }
      updatePendingAssistant((message) => ({
        ...message,
        content: error instanceof Error ? error.message : 'Failed to send message.',
        pending: false,
        error: true,
      }));
    } finally {
      if (isViewActive()) {
        setIsStreaming(false);
        abortRef.current = null;
      }
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
