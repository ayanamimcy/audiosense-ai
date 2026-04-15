// Re-exports from FSD layers — this file exists for backward compatibility during migration.
export { apiFetch, apiJson } from '@/shared/api/base';
export {
  getCurrentUser, getPublicConfig, loginWithPassword, registerWithPassword,
  logout, getStoredUser, storeUser, clearStoredUser,
} from '@/features/auth';
