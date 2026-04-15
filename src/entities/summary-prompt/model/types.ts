export interface SummaryPrompt {
  id: string;
  userId?: string;
  workspaceId?: string | null;
  name: string;
  prompt: string;
  notebookIds: string[];
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}
