export interface Notebook {
  id: string;
  userId?: string | null;
  workspaceId?: string | null;
  name: string;
  description?: string | null;
  color?: string | null;
  /** The notebook's own default summary template; null uses the workspace default. */
  defaultSummaryPromptId?: string | null;
  createdAt: number;
}
