export interface KnowledgeAnswer {
  answer: string;
  sources: Array<{
    id: string;
    originalName: string;
    notebookName?: string | null;
    tags: string[];
    snippet?: string;
  }>;
  retrieval: {
    mode: 'hybrid' | 'fts' | 'vector';
    embeddings: {
      configured: boolean;
      model: string;
      baseUrl: string;
    };
    chunkCount: number;
  };
}

export interface KnowledgeConversation {
  id: string;
  userId: string;
  workspaceId?: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeSourceCitation {
  content: string;
  startTime: number | null;
  endTime: number | null;
}

export interface KnowledgeSourceMeta {
  id: string;
  sourceIndex: number;
  originalName: string;
  notebookName?: string | null;
  tags: string[];
  snippet: string;
  citations?: KnowledgeSourceCitation[];
}

export interface KnowledgeMessageMetadata {
  sources?: KnowledgeSourceMeta[];
  retrieval?: {
    mode: string;
    chunkCount: number;
  };
}

export interface KnowledgeMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  mentions: MentionRef[];
  metadata: KnowledgeMessageMetadata | null;
  createdAt: number;
  pending?: boolean;
  error?: boolean;
}

export interface MentionRef {
  type: 'notebook' | 'task';
  id: string;
  name: string;
}

export interface MentionCandidate {
  type: 'notebook' | 'task';
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  notebookId?: string | null;
}
