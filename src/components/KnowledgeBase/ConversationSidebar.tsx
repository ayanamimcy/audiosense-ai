import { useEffect, useRef, useState } from 'react';
import { Check, MessageSquare, MessageSquarePlus, Pencil, Search, Trash2, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { KnowledgeConversation } from '../../types';

function groupConversations(conversations: KnowledgeConversation[]) {
  const now = Date.now();
  const dayMs = 86400000;
  const today: KnowledgeConversation[] = [];
  const yesterday: KnowledgeConversation[] = [];
  const thisWeek: KnowledgeConversation[] = [];
  const earlier: KnowledgeConversation[] = [];

  for (const conv of conversations) {
    const age = now - conv.updatedAt;
    if (age < dayMs) today.push(conv);
    else if (age < 2 * dayMs) yesterday.push(conv);
    else if (age < 7 * dayMs) thisWeek.push(conv);
    else earlier.push(conv);
  }

  const groups: { label: string; items: KnowledgeConversation[] }[] = [];
  if (today.length) groups.push({ label: 'Today', items: today });
  if (yesterday.length) groups.push({ label: 'Yesterday', items: yesterday });
  if (thisWeek.length) groups.push({ label: 'This week', items: thisWeek });
  if (earlier.length) groups.push({ label: 'Earlier', items: earlier });
  return groups;
}

function ConversationItem({
  conv,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: {
  conv: KnowledgeConversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(conv.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleSubmit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== conv.title) {
      onRename(trimmed);
    }
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-1 px-2 py-1.5">
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
            if (e.key === 'Escape') { setEditValue(conv.title); setIsEditing(false); }
          }}
          onBlur={handleSubmit}
          className="flex-1 min-w-0 px-2 py-1 text-sm rounded-lg border border-indigo-300 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <button type="button" onClick={handleSubmit} className="p-1 text-indigo-600 hover:bg-indigo-50 rounded">
          <Check className="w-3.5 h-3.5" />
        </button>
        <button type="button" onClick={() => { setEditValue(conv.title); setIsEditing(false); }} className="p-1 text-slate-400 hover:bg-slate-100 rounded">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-colors',
        isActive ? 'bg-indigo-50' : 'hover:bg-slate-50',
      )}
    >
      <MessageSquare className={cn('w-4 h-4 shrink-0', isActive ? 'text-indigo-500' : 'text-slate-400')} />
      <p className={cn('text-sm truncate flex-1', isActive ? 'text-indigo-900 font-medium' : 'text-slate-700')}>
        {conv.title}
      </p>
      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setEditValue(conv.title); setIsEditing(true); }}
          className="p-1 text-slate-400 hover:text-indigo-600 rounded transition-colors"
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1 text-slate-400 hover:text-red-500 rounded transition-colors"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </button>
  );
}

function ConversationList({
  conversations,
  activeId,
  onSelect,
  onDelete,
  onRename,
  searchQuery,
}: {
  conversations: KnowledgeConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  searchQuery: string;
}) {
  const filtered = searchQuery
    ? conversations.filter((c) => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : conversations;
  const groups = groupConversations(filtered);

  if (groups.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-slate-400">
          {searchQuery ? 'No matches found.' : 'No conversations yet.'}
        </p>
      </div>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <div key={group.label} className="mb-3">
          <p className="text-xs font-medium text-slate-400 px-2 mb-1">{group.label}</p>
          {group.items.map((conv) => (
            <ConversationItem
              key={conv.id}
              conv={conv}
              isActive={activeId === conv.id}
              onSelect={() => onSelect(conv.id)}
              onDelete={() => onDelete(conv.id)}
              onRename={(title) => onRename(conv.id, title)}
            />
          ))}
        </div>
      ))}
    </>
  );
}

/* ── PC: persistent sidebar (ChatGPT style) ── */

export function DesktopSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
}: {
  conversations: KnowledgeConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="flex flex-col h-full bg-slate-50 rounded-2xl border border-slate-200">
      <div className="p-3 border-b border-slate-200">
        <button
          type="button"
          onClick={onNew}
          className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 transition-colors"
        >
          <MessageSquarePlus className="w-4 h-4" />
          New conversation
        </button>
      </div>

      <div className="px-3 py-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-slate-200">
          <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            className="flex-1 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-3">
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          onSelect={onSelect}
          onDelete={onDelete}
          onRename={onRename}
          searchQuery={searchQuery}
        />
      </div>
    </div>
  );
}

/* ── Mobile: bottom sheet drawer (Notta Brain style) ── */

export function HistoryDrawer({
  isOpen,
  onClose,
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
}: {
  isOpen: boolean;
  onClose: () => void;
  conversations: KnowledgeConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchRef.current?.focus(), 100);
    } else {
      setSearchQuery('');
    }
  }, [isOpen]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEsc);
      return () => document.removeEventListener('keydown', handleEsc);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-2xl max-h-[80vh] flex flex-col">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-slate-300" />
        </div>

        <div className="flex items-center justify-between px-5 py-2 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">History</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { onNew(); onClose(); }}
              className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
            >
              <MessageSquarePlus className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-slate-100">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search"
              className="flex-1 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <ConversationList
            conversations={conversations}
            activeId={activeId}
            onSelect={(id) => { onSelect(id); onClose(); }}
            onDelete={onDelete}
            onRename={onRename}
            searchQuery={searchQuery}
          />
        </div>
      </div>
    </>
  );
}
