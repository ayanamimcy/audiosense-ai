import { useCallback, useEffect, useRef, useState } from 'react';
import { AtSign, Book, FileAudio, Loader2, SendHorizontal, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { MentionCandidate, MentionRef } from '../../types';

export function MentionInput({
  value,
  onChange,
  onSend,
  mentions,
  onRemoveMention,
  mentionCandidates,
  isMentionMenuOpen,
  isMentionLoading,
  onMentionTrigger,
  onMentionClose,
  onMentionSelect,
  disabled,
  isSending,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  mentions: MentionRef[];
  onRemoveMention: (id: string) => void;
  mentionCandidates: MentionCandidate[];
  isMentionMenuOpen: boolean;
  isMentionLoading: boolean;
  onMentionTrigger: (query: string) => void;
  onMentionClose: () => void;
  onMentionSelect: (candidate: MentionCandidate) => void;
  disabled?: boolean;
  isSending?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const canSend = !disabled && !isSending && value.trim().length > 0;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    const next = Math.min(Math.max(textarea.scrollHeight, 44), 120);
    textarea.style.height = `${next}px`;
    textarea.style.overflowY = textarea.scrollHeight > 120 ? 'auto' : 'hidden';
  }, [value]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [mentionCandidates]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onMentionClose();
      }
    };
    if (isMentionMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isMentionMenuOpen, onMentionClose]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    onChange(newValue);

    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = newValue.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@([^@\s]*)$/);

    if (atMatch) {
      onMentionTrigger(atMatch[1]);
    } else if (isMentionMenuOpen) {
      onMentionClose();
    }
  }, [onChange, onMentionTrigger, onMentionClose, isMentionMenuOpen]);

  const handleSelectCandidate = useCallback((candidate: MentionCandidate) => {
    onMentionSelect(candidate);

    const textarea = textareaRef.current;
    if (textarea) {
      const cursorPos = textarea.selectionStart;
      const textBeforeCursor = value.slice(0, cursorPos);
      const atIndex = textBeforeCursor.lastIndexOf('@');
      if (atIndex >= 0) {
        const newValue = value.slice(0, atIndex) + value.slice(cursorPos);
        onChange(newValue);
      }
    }
  }, [onMentionSelect, value, onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isMentionMenuOpen && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % mentionCandidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + mentionCandidates.length) % mentionCandidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleSelectCandidate(mentionCandidates[selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onMentionClose();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && canSend) {
      e.preventDefault();
      onSend();
    }
  }, [isMentionMenuOpen, mentionCandidates, selectedIndex, canSend, onSend, onMentionClose, handleSelectCandidate]);

  return (
    <div className="relative">
      {mentions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {mentions.map((mention) => (
            <span
              key={`${mention.type}-${mention.id}`}
              className={cn(
                'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium',
                mention.type === 'notebook'
                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                  : 'bg-blue-50 text-blue-800 border border-blue-200',
              )}
            >
              {mention.type === 'notebook' ? (
                <Book className="w-3 h-3" />
              ) : (
                <FileAudio className="w-3 h-3" />
              )}
              {mention.name.length > 30 ? mention.name.slice(0, 27) + '...' : mention.name}
              <button
                type="button"
                onClick={() => onRemoveMention(mention.id)}
                className="ml-0.5 hover:text-red-600 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Mobile: gradient border, PC: standard border */}
      <div className="rounded-2xl p-[1.5px] bg-gradient-to-r from-pink-400 via-purple-400 to-indigo-400 lg:bg-none lg:p-0 lg:border lg:border-slate-200 lg:rounded-2xl focus-within:lg:ring-2 focus-within:lg:ring-indigo-500 focus-within:lg:border-indigo-300 transition-shadow">
        <div className="flex items-end gap-2 rounded-[calc(1rem-1px)] lg:rounded-[calc(1rem-1px)] bg-white px-3 py-2">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? 'Configure LLM to enable chat...' : "Type '@' to select files to analyze"}
            disabled={disabled || isSending}
            className="min-h-[44px] flex-1 resize-none border-0 bg-transparent px-0 py-[10px] text-[15px] leading-6 text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:text-slate-400"
          />

          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            className={cn(
              'mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors',
              canSend
                ? 'bg-indigo-600 text-white shadow-sm active:bg-indigo-700'
                : 'bg-slate-100 text-slate-400',
            )}
          >
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
          </button>
        </div>

        {/* Action buttons row inside gradient border */}
        <div className="flex items-center gap-1 px-3 pb-2 -mt-1 bg-white rounded-b-[calc(1rem-1px)]">
          <button
            type="button"
            onClick={() => {
              if (isMentionMenuOpen) {
                onMentionClose();
              } else {
                onMentionTrigger('');
                textareaRef.current?.focus();
              }
            }}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
              isMentionMenuOpen
                ? 'bg-indigo-100 text-indigo-600'
                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100',
            )}
            title="Mention a notebook or recording (@)"
          >
            <AtSign className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isMentionMenuOpen && (
        <div
          ref={menuRef}
          className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-xl border border-slate-200 shadow-lg max-h-64 overflow-y-auto z-50"
        >
          {isMentionLoading ? (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading...
            </div>
          ) : mentionCandidates.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-400">
              Type to search notebooks and recordings...
            </div>
          ) : (
            mentionCandidates.map((candidate, index) => (
              <button
                key={`${candidate.type}-${candidate.id}`}
                type="button"
                onClick={() => handleSelectCandidate(candidate)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors',
                  index === selectedIndex
                    ? 'bg-indigo-50 text-indigo-900'
                    : 'hover:bg-slate-50 text-slate-700',
                )}
              >
                <div className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                  candidate.type === 'notebook'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-blue-100 text-blue-700',
                )}>
                  {candidate.type === 'notebook' ? (
                    <Book className="w-3.5 h-3.5" />
                  ) : (
                    <FileAudio className="w-3.5 h-3.5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{candidate.name}</p>
                  <p className="text-xs text-slate-400 capitalize">{candidate.type}</p>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
