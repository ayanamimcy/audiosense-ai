import React, { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Check, Copy, Key, Plus, Trash2 } from 'lucide-react';
import { apiJson } from '../api';
import { cn } from '../lib/utils';
import type { ApiTokenInfo } from '../types';

const SCOPE_OPTIONS = [
  { pattern: 'POST:/api/upload/*', label: 'Upload files' },
  { pattern: 'GET:/api/tasks', label: 'List tasks' },
  { pattern: 'GET:/api/tasks/*', label: 'Task details' },
  { pattern: 'GET:/api/notebooks', label: 'List notebooks' },
  { pattern: 'GET:/api/notebooks/*', label: 'Notebook details' },
];

const EXPIRY_OPTIONS = [
  { label: 'Never', value: '' },
  { label: '30 days', value: '30' },
  { label: '90 days', value: '90' },
  { label: '1 year', value: '365' },
];

export function ApiTokensSection() {
  const [tokens, setTokens] = useState<ApiTokenInfo[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['POST:/api/upload/*', 'GET:/api/tasks']);
  const [expiry, setExpiry] = useState('');
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const fetchTokens = useCallback(async () => {
    try {
      const result = await apiJson<{ tokens: ApiTokenInfo[] }>('/api/api-tokens');
      setTokens(result.tokens || []);
    } catch {
      setTokens([]);
    }
  }, []);

  useEffect(() => {
    void fetchTokens();
  }, [fetchTokens]);

  const handleCreate = async () => {
    if (!name.trim() || selectedScopes.length === 0) return;
    setIsSaving(true);
    try {
      const expiresAt = expiry ? Date.now() + Number(expiry) * 24 * 60 * 60 * 1000 : null;
      const result = await apiJson<{ token: string }>('/api/api-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scopes: selectedScopes, expiresAt }),
      });
      setCreatedToken(result.token);
      setName('');
      setSelectedScopes(['POST:/api/upload/*', 'GET:/api/tasks']);
      setExpiry('');
      setIsCreating(false);
      await fetchTokens();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to create token.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRevoke = async (tokenId: string) => {
    if (!confirm('Revoke this API token? Any clients using it will stop working.')) return;
    try {
      await apiJson(`/api/api-tokens/${tokenId}`, { method: 'DELETE' });
      await fetchTokens();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to revoke token.');
    }
  };

  const handleCopy = () => {
    if (!createdToken) return;
    void navigator.clipboard.writeText(createdToken).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const toggleScope = (pattern: string) => {
    setSelectedScopes((current) =>
      current.includes(pattern)
        ? current.filter((s) => s !== pattern)
        : [...current, pattern],
    );
  };

  return (
    <div className="rounded-2xl border border-slate-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-900">API Tokens</h3>
          <p className="text-sm text-slate-500 mt-1">For external access like iOS Shortcuts.</p>
        </div>
        {!isCreating && !createdToken && (
          <button
            onClick={() => setIsCreating(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Token
          </button>
        )}
      </div>

      {createdToken && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
          <p className="text-sm font-medium text-amber-800">Token created — copy it now. It won't be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate rounded-lg bg-white border border-amber-200 px-3 py-2 text-xs font-mono text-slate-800">
              {createdToken}
            </code>
            <button
              onClick={handleCopy}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button
            onClick={() => { setCreatedToken(null); setCopied(false); }}
            className="text-xs text-amber-700 hover:text-amber-900"
          >
            Dismiss
          </button>
        </div>
      )}

      {isCreating && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-700">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. iOS Shortcut"
              className="w-full mt-1 px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>
          <div>
            <span className="text-xs font-medium text-slate-700">Allowed endpoints</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {SCOPE_OPTIONS.map((scope) => (
                <button
                  key={scope.pattern}
                  type="button"
                  onClick={() => toggleScope(scope.pattern)}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors',
                    selectedScopes.includes(scope.pattern)
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
                  )}
                >
                  {scope.label}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-slate-700">Expires</span>
            <select
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              className="w-full mt-1 px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {EXPIRY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => void handleCreate()}
              disabled={isSaving || !name.trim() || selectedScopes.length === 0}
              className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {isSaving ? 'Creating...' : 'Create Token'}
            </button>
            <button
              onClick={() => setIsCreating(false)}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {tokens.length > 0 && (
        <div className="space-y-2">
          {tokens.map((token) => (
            <div key={token.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Key className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="text-sm font-medium text-slate-800 truncate">{token.name}</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {token.scopes.map((s) => (
                    <span key={s} className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                      {s}
                    </span>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 mt-1.5">
                  Created {format(token.createdAt, 'MMM d, yyyy')}
                  {token.lastUsedAt ? ` · Last used ${format(token.lastUsedAt, 'MMM d, HH:mm')}` : ' · Never used'}
                  {token.expiresAt ? ` · Expires ${format(token.expiresAt, 'MMM d, yyyy')}` : ''}
                </p>
              </div>
              <button
                onClick={() => void handleRevoke(token.id)}
                className="shrink-0 p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Revoke token"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {tokens.length === 0 && !isCreating && !createdToken && (
        <p className="text-xs text-slate-400 text-center py-3">No API tokens yet.</p>
      )}
    </div>
  );
}
