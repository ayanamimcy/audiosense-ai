export interface Workspace {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  color?: string | null;
  createdAt: number;
  updatedAt: number;
}
