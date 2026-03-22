import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import ReactMarkdown from 'react-markdown';
import {
  Book,
  Check,
  Edit2,
  Loader2,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Tag,
  Users,
  Waves,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { apiFetch } from './api';
import type { AppCapabilities, Notebook, Task, TaskMessage } from './types';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${mins}:${secs}`;
}

type Panel = 'summary' | 'transcript' | 'chat';

export function TaskDetail({
  task,
  notebooks,
  capabilities,
  onUpdateTask,
}: {
  task: Task;
  notebooks: Notebook[];
  capabilities: AppCapabilities | null;
  onUpdateTask: () => void | Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [activePanel, setActivePanel] = useState<Panel>('summary');
  const [editName, setEditName] = useState(task.originalName);
  const [editTags, setEditTags] = useState(task.tags.join(', '));
  const [editNotebookId, setEditNotebookId] = useState(task.notebookId || '');
  const [editDate, setEditDate] = useState(format(new Date(task.eventDate || task.createdAt), 'yyyy-MM-dd'));
  const [summaryInstructions, setSummaryInstructions] = useState('');
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [messages, setMessages] = useState<TaskMessage[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  useEffect(() => {
    setEditName(task.originalName);
    setEditTags(task.tags.join(', '));
    setEditNotebookId(task.notebookId || '');
    setEditDate(format(new Date(task.eventDate || task.createdAt), 'yyyy-MM-dd'));
    setIsEditing(false);
    setSummaryInstructions('');
    setActivePanel(task.summary ? 'summary' : 'transcript');
  }, [task.id]);

  useEffect(() => {
    const loadMessages = async () => {
      try {
        const res = await apiFetch(`/api/tasks/${task.id}/messages`);
        if (!res.ok) {
          setMessages([]);
          return;
        }

        setMessages((await res.json()) as TaskMessage[]);
      } catch (error) {
        console.error('Failed to load messages:', error);
        setMessages([]);
      }
    };

    void loadMessages();
  }, [task.id]);

  const handleSave = async () => {
    const tagsArray = editTags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

    const [year, month, day] = editDate.split('-');
    const eventDateTimestamp =
      year && month && day ? new Date(Number(year), Number(month) - 1, Number(day)).getTime() : task.eventDate || task.createdAt;

    try {
      const res = await apiFetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalName: editName.trim(),
          tags: tagsArray,
          notebookId: editNotebookId || null,
          eventDate: eventDateTimestamp,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to update task.');
      }

      setIsEditing(false);
      await onUpdateTask();
    } catch (error) {
      console.error('Failed to update task', error);
    }
  };

  const handleGenerateSummary = async () => {
    setIsGeneratingSummary(true);
    try {
      const res = await apiFetch(`/api/tasks/${task.id}/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: summaryInstructions }),
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to generate summary.');
      }

      setActivePanel('summary');
      setSummaryInstructions('');
      await onUpdateTask();
    } catch (error: any) {
      console.error('Failed to generate summary:', error);
      alert(error.message || 'Failed to generate summary.');
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const handleSendMessage = async () => {
    const message = messageInput.trim();
    if (!message) {
      return;
    }

    setIsSendingMessage(true);
    try {
      const res = await apiFetch(`/api/tasks/${task.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const payload = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to send message.');
      }

      setMessages(payload as TaskMessage[]);
      setMessageInput('');
      setActivePanel('chat');
    } catch (error: any) {
      console.error('Failed to chat with transcript:', error);
      alert(error.message || 'Failed to chat with transcript.');
    } finally {
      setIsSendingMessage(false);
    }
  };

  const notebook = notebooks.find((item) => item.id === task.notebookId);

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 border-b border-slate-200 bg-slate-50/60 flex flex-col gap-4 shrink-0">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-[280px]">
            {isEditing ? (
              <div className="space-y-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Tags</label>
                  <input
                    type="text"
                    value={editTags}
                    onChange={(event) => setEditTags(event.target.value)}
                    placeholder="meeting, action items"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Notebook</label>
                    <select
                      value={editNotebookId}
                      onChange={(event) => setEditNotebookId(event.target.value)}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">None</option>
                      {notebooks.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Date</label>
                    <input
                      type="date"
                      value={editDate}
                      onChange={(event) => setEditDate(event.target.value)}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => setIsEditing(false)} className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">
                    Cancel
                  </button>
                  <button onClick={() => void handleSave()} className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg flex items-center gap-1">
                    <Check className="w-4 h-4" /> Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-xl font-semibold text-slate-900 truncate">{task.originalName}</h2>
                  <button onClick={() => setIsEditing(true)} className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 hover:text-indigo-600 rounded-lg flex items-center gap-1.5 transition-colors shadow-sm shrink-0">
                    <Edit2 className="w-3.5 h-3.5" /> Edit Task
                  </button>
                </div>
                <div className="flex items-center flex-wrap gap-3 mt-3">
                  <span
                    className={cn(
                      'px-2.5 py-0.5 rounded-full text-xs font-medium capitalize border',
                      task.status === 'completed'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : task.status === 'processing'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : task.status === 'failed'
                            ? 'bg-red-50 text-red-700 border-red-200'
                            : 'bg-slate-100 text-slate-700 border-slate-200',
                    )}
                  >
                    {task.status}
                  </span>
                  <span className="text-sm text-slate-500">{format(new Date(task.eventDate || task.createdAt), 'MMM d, yyyy')}</span>
                  {task.language && <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">{task.language}</span>}
                  {task.provider && <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">{task.provider}</span>}
                  {task.durationSeconds ? <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">{task.durationSeconds.toFixed(1)}s</span> : null}
                  {notebook && (
                    <span className="flex items-center gap-1 text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                      <Book className="w-3 h-3" />
                      {notebook.name}
                    </span>
                  )}
                  {task.tags.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      <Tag className="w-3 h-3 text-slate-400" />
                      {task.tags.map((tag) => (
                        <span key={tag} className="text-xs text-slate-600 bg-slate-200/50 px-2 py-0.5 rounded-md border border-slate-200">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <audio controls src={`/api/audio/${task.filename}`} className="h-10 w-full sm:w-72 shrink-0" />
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <StatCard icon={<Users className="w-4 h-4 text-indigo-600" />} label="Speakers" value={String(task.speakers.length || 0)} />
          <StatCard icon={<Waves className="w-4 h-4 text-emerald-600" />} label="Segments" value={String(task.segments.length || 0)} />
          <StatCard icon={<Sparkles className="w-4 h-4 text-amber-600" />} label="LLM" value={capabilities?.llm.configured ? capabilities.llm.model : 'Not configured'} />
        </div>
      </div>

      <div className="border-b border-slate-200 bg-white px-6 py-3 flex items-center gap-2 shrink-0 overflow-x-auto">
        <PanelButton active={activePanel === 'summary'} onClick={() => setActivePanel('summary')} icon={<Sparkles className="w-4 h-4" />}>
          Summary
        </PanelButton>
        <PanelButton active={activePanel === 'transcript'} onClick={() => setActivePanel('transcript')} icon={<Waves className="w-4 h-4" />}>
          Transcript
        </PanelButton>
        <PanelButton active={activePanel === 'chat'} onClick={() => setActivePanel('chat')} icon={<MessageSquare className="w-4 h-4" />}>
          Chat
        </PanelButton>
        {task.status === 'completed' && (
          <button
            onClick={async () => {
              await apiFetch(`/api/tasks/${task.id}/reprocess`, { method: 'POST' });
              await onUpdateTask();
            }}
            className="ml-auto px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 bg-slate-100 rounded-lg flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reprocess
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 bg-white custom-scrollbar">
        {task.status === 'processing' || task.status === 'pending' ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-4">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            <p>Analyzing audio... This may take a few moments.</p>
          </div>
        ) : task.status === 'failed' ? (
          <div className="p-4 bg-red-50 text-red-700 rounded-xl border border-red-100">
            <h3 className="font-semibold mb-1">Analysis Failed</h3>
            <p className="text-sm whitespace-pre-wrap">{task.result}</p>
          </div>
        ) : (
          <>
            {activePanel === 'summary' && (
              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">Summary Workspace</h3>
                      <p className="text-sm text-slate-500 mt-1">用 LLM 基于当前转写生成总结、要点和行动项。</p>
                    </div>
                    <button
                      onClick={() => void handleGenerateSummary()}
                      disabled={isGeneratingSummary || !capabilities?.llm.configured || !task.transcript}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isGeneratingSummary ? 'Generating...' : task.summary ? 'Regenerate Summary' : 'Generate Summary'}
                    </button>
                  </div>
                  <textarea
                    value={summaryInstructions}
                    onChange={(event) => setSummaryInstructions(event.target.value)}
                    placeholder="可选：例如“请重点总结会议决策、风险项和待办事项”。"
                    className="w-full mt-4 min-h-24 px-4 py-3 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  {!capabilities?.llm.configured && <p className="text-sm text-amber-600 mt-3">当前还没有配置 LLM API，摘要和对话功能暂时不可用。</p>}
                </div>

                {task.summary ? (
                  <div className="prose prose-slate max-w-none prose-headings:font-semibold prose-a:text-indigo-600">
                    <ReactMarkdown>{task.summary}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                    还没有生成摘要。你可以直接生成，也可以先写一段自定义总结要求。
                  </div>
                )}
              </div>
            )}

            {activePanel === 'transcript' && (
              <div className="space-y-6">
                {task.speakers.length > 0 && (
                  <div className="grid gap-3 md:grid-cols-2">
                    {task.speakers.map((speaker) => (
                      <div key={speaker.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-sm font-semibold text-slate-900">{speaker.label}</p>
                        <p className="text-sm text-slate-500 mt-1">{speaker.segmentCount} segments</p>
                        <p className="text-sm text-slate-500">{speaker.durationSeconds.toFixed(1)} seconds</p>
                      </div>
                    ))}
                  </div>
                )}

                {task.segments.length > 0 ? (
                  <div className="space-y-3">
                    {task.segments.map((segment) => (
                      <div key={segment.id} className="rounded-2xl border border-slate-200 p-4">
                        <div className="flex items-center gap-3 flex-wrap mb-2">
                          <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                            {formatTime(segment.start)} - {formatTime(segment.end)}
                          </span>
                          <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                            {segment.speaker || 'Speaker'}
                          </span>
                        </div>
                        <p className="text-sm leading-6 text-slate-700">{segment.text}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="prose prose-slate max-w-none prose-headings:font-semibold prose-a:text-indigo-600">
                    <ReactMarkdown>{task.result || task.transcript || ''}</ReactMarkdown>
                  </div>
                )}
              </div>
            )}

            {activePanel === 'chat' && (
              <div className="flex flex-col h-full min-h-[420px]">
                <div className="flex-1 space-y-3 overflow-y-auto custom-scrollbar pr-1">
                  {messages.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                      还没有对话。你可以直接问“这段录音的结论是什么？”或“列出所有 action items”。
                    </div>
                  ) : (
                    messages.map((message) => (
                      <div
                        key={message.id}
                        className={cn(
                          'max-w-[90%] rounded-2xl px-4 py-3',
                          message.role === 'user' ? 'ml-auto bg-indigo-600 text-white' : 'bg-slate-100 text-slate-800',
                        )}
                      >
                        <p className="text-xs opacity-70 mb-1">{message.role === 'user' ? 'You' : 'Assistant'}</p>
                        <div className="prose prose-sm max-w-none prose-p:my-0 prose-headings:my-2 [&_*]:text-inherit">
                          <ReactMarkdown>{message.content}</ReactMarkdown>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-4 border-t border-slate-200 pt-4">
                  <div className="flex gap-3">
                    <textarea
                      value={messageInput}
                      onChange={(event) => setMessageInput(event.target.value)}
                      placeholder={capabilities?.llm.configured ? 'Ask about this transcript...' : 'Configure LLM API first to enable chat.'}
                      disabled={!capabilities?.llm.configured || isSendingMessage}
                      className="flex-1 min-h-24 px-4 py-3 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50"
                    />
                    <button
                      onClick={() => void handleSendMessage()}
                      disabled={!capabilities?.llm.configured || isSendingMessage || !messageInput.trim()}
                      className="self-end px-4 py-3 rounded-2xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSendingMessage ? 'Sending...' : 'Send'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PanelButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-2 transition-colors',
        active ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function StatCard({
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
