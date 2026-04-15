export interface Notebook {
  id: string;
  userId?: string | null;
  workspaceId?: string | null;
  name: string;
  description?: string | null;
  color?: string | null;
  createdAt: number;
}
