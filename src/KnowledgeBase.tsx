import { useEffect, useState } from 'react';
import { useAppDataContext } from './contexts/AppDataContext';
import { useKnowledgeChat } from './hooks/useKnowledgeChat';
import { useMentions } from './hooks/useMentions';
import { DesktopSidebar, HistoryDrawer } from './components/KnowledgeBase/ConversationSidebar';
import { KnowledgeChatPanel } from './components/KnowledgeBase/KnowledgeChatPanel';
import type { KnowledgeMessage, MentionRef } from './types';

function extractMentionsFromMessages(messages: KnowledgeMessage[]): MentionRef[] {
  const seen = new Map<string, MentionRef>();
  for (const msg of messages) {
    if (msg.mentions) {
      for (const m of msg.mentions) {
        seen.set(`${m.type}-${m.id}`, m);
      }
    }
  }
  return [...seen.values()];
}

export function KnowledgeBase({
  onSelectTask,
}: {
  onSelectTask: (taskId: string, seekTo?: number) => void;
}) {
  const { capabilities } = useAppDataContext();
  const llmConfigured = Boolean(capabilities?.llm.configured);
  const [messageInput, setMessageInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  const {
    conversations,
    activeConversationId,
    messages,
    isStreaming,
    loadConversations,
    loadMessages,
    startNewConversation,
    deleteConversation,
    renameConversation,
    sendMessage,
  } = useKnowledgeChat();

  const {
    candidates,
    selectedMentions,
    isLoading: isMentionLoading,
    isOpen: isMentionMenuOpen,
    openMentionMenu,
    closeMentionMenu,
    selectMention,
    removeMention,
    clearMentions,
    restoreMentions,
  } = useMentions();

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const handleSend = (directMessage?: string) => {
    const content = directMessage || messageInput;
    if (!content.trim()) return;
    // Pass current mentions but don't clear them — they persist for the conversation
    void sendMessage(content.trim(), selectedMentions);
    setMessageInput('');
  };

  const handleSelectConversation = async (id: string) => {
    const loaded = await loadMessages(id);
    // Restore mentions from conversation history
    const historicMentions = extractMentionsFromMessages(loaded);
    restoreMentions(historicMentions);
  };

  const handleNewConversation = () => {
    startNewConversation();
    setMessageInput('');
    clearMentions();
  };

  return (
    <div className="h-full flex gap-4">
      {/* PC: persistent sidebar (hidden on mobile) */}
      <div className="hidden lg:block w-[280px] shrink-0">
        <DesktopSidebar
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={(id) => void handleSelectConversation(id)}
          onNew={handleNewConversation}
          onDelete={(id) => void deleteConversation(id)}
          onRename={(id, title) => void renameConversation(id, title)}
        />
      </div>

      {/* Chat panel (full width on mobile, flex-1 on PC) */}
      <div className="flex-1 min-w-0">
        <KnowledgeChatPanel
          messages={messages}
          isStreaming={isStreaming}
          messageInput={messageInput}
          onMessageInputChange={setMessageInput}
          onSend={handleSend}
          mentions={selectedMentions}
          onRemoveMention={removeMention}
          mentionCandidates={candidates}
          isMentionMenuOpen={isMentionMenuOpen}
          isMentionLoading={isMentionLoading}
          onMentionTrigger={openMentionMenu}
          onMentionClose={closeMentionMenu}
          onMentionSelect={selectMention}
          llmConfigured={llmConfigured}
          onSelectTask={onSelectTask}
          onOpenHistory={() => setHistoryOpen(true)}
          onNewConversation={handleNewConversation}
        />
      </div>

      {/* Mobile: bottom sheet drawer (only rendered on mobile) */}
      <HistoryDrawer
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        conversations={conversations}
        activeId={activeConversationId}
        onSelect={(id) => void handleSelectConversation(id)}
        onNew={handleNewConversation}
        onDelete={(id) => void deleteConversation(id)}
        onRename={(id, title) => void renameConversation(id, title)}
      />
    </div>
  );
}
