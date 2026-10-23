import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/shared/api/base';
import { consumeSseStream } from '@/shared/lib/sse-stream';
import type { TaskMessage } from '@/entities/task';

/** Per-recording chat state; lives above the tabs so switching tabs keeps a streaming reply. */
export function useTaskChat(taskId: string) {
  const [messages, setMessages] = useState<TaskMessage[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setMessageInput('');

    const loadMessages = async () => {
      try {
        const res = await apiFetch(`/api/tasks/${taskId}/messages`);
        if (cancelled) return;
        setMessages(res.ok ? ((await res.json()) as TaskMessage[]) : []);
      } catch (error) {
        console.error('Failed to load messages:', error);
        if (!cancelled) setMessages([]);
      }
    };

    void loadMessages();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const sendMessage = useCallback(async (directMessage?: string) => {
    const message = (directMessage || messageInput).trim();
    if (!message) {
      return;
    }

    const now = Date.now();
    const optimisticUserMessage: TaskMessage = {
      id: `pending-user-${now}`,
      taskId,
      role: 'user',
      content: message,
      createdAt: now,
    };
    const optimisticAssistantMessage: TaskMessage = {
      id: `pending-assistant-${now}`,
      taskId,
      role: 'assistant',
      content: '',
      createdAt: now + 1,
      pending: true,
    };
    const patchAssistant = (patch: (item: TaskMessage) => TaskMessage) => {
      setMessages((prev) => prev.map((item) => (item.id === optimisticAssistantMessage.id ? patch(item) : item)));
    };

    setMessages((prev) => [...prev, optimisticUserMessage, optimisticAssistantMessage]);
    setMessageInput('');
    setIsSendingMessage(true);
    try {
      const res = await apiFetch(`/api/tasks/${taskId}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to send message.');
      }

      let completed = false;

      await consumeSseStream(res, {
        onDelta: (payload) => {
          const delta = typeof payload?.text === 'string' ? payload.text : '';
          if (delta) {
            patchAssistant((item) => ({ ...item, content: `${item.content}${delta}` }));
          }
        },
        onDone: (payload) => {
          completed = true;
          if (Array.isArray(payload?.messages)) {
            setMessages(payload.messages as TaskMessage[]);
            return;
          }
          patchAssistant((item) => ({ ...item, pending: false }));
        },
        onError: (payload) => {
          throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to send message.');
        },
      });

      if (!completed) {
        patchAssistant((item) => ({ ...item, pending: false }));
      }
    } catch (error: unknown) {
      patchAssistant((item) => ({
        ...item,
        pending: false,
        error: true,
        content: error instanceof Error ? error.message : 'Failed to send message.',
      }));
      console.error('Failed to chat with transcript:', error);
    } finally {
      setIsSendingMessage(false);
    }
  }, [messageInput, taskId]);

  return { messages, messageInput, setMessageInput, isSendingMessage, sendMessage };
}
