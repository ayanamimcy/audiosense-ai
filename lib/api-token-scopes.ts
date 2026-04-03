/**
 * Each scope is "METHOD:path" where METHOD is GET/POST/etc.
 * Path supports trailing /* for prefix matching.
 */
export const ALL_SCOPES = [
  { pattern: 'POST:/api/upload/*', label: 'Upload files' },
  { pattern: 'GET:/api/tasks', label: 'List tasks' },
  { pattern: 'GET:/api/tasks/*', label: 'Read task details' },
  { pattern: 'GET:/api/notebooks', label: 'List notebooks' },
  { pattern: 'GET:/api/notebooks/*', label: 'Read notebooks' },
] as const;

const ALLOWED_SCOPE_SET = new Set<string>(ALL_SCOPES.map((s) => s.pattern));

export function matchesScope(method: string, requestPath: string, scopes: string[]): boolean {
  const upperMethod = method.toUpperCase();
  for (const scope of scopes) {
    const colonIndex = scope.indexOf(':');
    if (colonIndex < 0) continue;
    const scopeMethod = scope.slice(0, colonIndex).toUpperCase();
    const pattern = scope.slice(colonIndex + 1);

    if (scopeMethod !== upperMethod) continue;

    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2);
      if (requestPath === prefix || requestPath.startsWith(prefix + '/')) {
        return true;
      }
    } else if (requestPath === pattern) {
      return true;
    }
  }
  return false;
}

export function validateScopes(scopes: unknown): string[] {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error('At least one scope is required.');
  }

  const result: string[] = [];
  for (const scope of scopes) {
    const value = typeof scope === 'string' ? scope.trim() : '';
    if (!ALLOWED_SCOPE_SET.has(value)) {
      throw new Error(`Invalid scope: "${String(scope)}". Must be one of: ${[...ALLOWED_SCOPE_SET].join(', ')}`);
    }
    result.push(value);
  }

  return result;
}
