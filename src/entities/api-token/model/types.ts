export interface ApiTokenInfo {
  id: string;
  name: string;
  scopes: string[];
  expiresAt: number | null;
  createdAt: number;
  lastUsedAt: number | null;
}
