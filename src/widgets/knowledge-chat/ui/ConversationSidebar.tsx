import { useEffect, useRef, useState } from 'react';
import { Check, MessageSquare, MessageSquarePlus, Pencil, Search, Trash2, X } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import type { KnowledgeConversation } from '@/entities/knowledge';

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
          className="flex-1 min-w-0 px-2 py-1 text-sm rounded-lg border border-stone-300 bg-white focus:outline-none focus:ring-1 focus:ring-stone-900/10"
        />
        <button type="button" onClick={handleSubmit} className="p-1 text-stone-900 hover:bg-stone-100 rounded">
          <Check className="w-3.5 h-3.5" />
        </button>
        <button type="button" onClick={() => { setEditValue(conv.title); setIsEditing(false); }} className="p-1 text-stone-400 hover:bg-stone-100 rounded">
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
        isActive ? 'bg-stone-200/70' : 'hover:bg-stone-100',
      )}
    >
      <MessageSquare className={cn('w-4 h-4 shrink-0', isActive ? 'text-stone-700' : 'text-stone-400')} />
      <p className={cn('text-sm truncate flex-1', isActive ? 'text-stone-900 font-medium' : 'text-stone-700')}>
        {conv.title}
      </p>
      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setEditValue(conv.title); setIsEditing(true); }}
          className="p-1 text-stone-400 hover:text-stone-900 rounded transition-colors"
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1 text-stone-400 hover:text-red-500 rounded transition-colors"
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
        <p className="text-sm text-stone-400">
          {searchQuery ? 'No matches found.' : 'No conversations yet.'}
        </p>
      </div>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <div key={group.label} className="mb-3">
          <p className="text-xs font-medium text-stone-400 px-2 mb-1">{group.label}</p>
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
    <div className="flex h-full flex-col">
      <div className="p-3">
        <button
          type="button"
          onClick={onNew}
          className="w-full flex items-center justify-center gap-2 h-10 rounded-xl bg-stone-900 text-sm font-medium text-white hover:bg-stone-800 transition-colors"
        >
          <MessageSquarePlus className="w-4 h-4" />
          New conversation
        </button>
      </div>

      <div className="px-3 py-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-stone-200">
          <Search className="w-3.5 h-3.5 text-stone-400 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            className="flex-1 bg-transparent text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none"
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
          <div className="w-10 h-1 rounded-full bg-stone-300" />
        </div>

        <div className="flex items-center justify-between px-5 py-2 border-b border-stone-100">
          <h2 className="text-base font-semibold text-stone-900">History</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { onNew(); onClose(); }}
              className="p-2 text-stone-500 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors"
            >
              <MessageSquarePlus className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-stone-100">
            <Search className="w-4 h-4 text-stone-400 shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search"
              className="flex-1 bg-transparent text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none"
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
