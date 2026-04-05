import React, { useMemo, useState } from 'react';
import { BrainCircuit, Loader2, Search } from 'lucide-react';
import { apiJson } from './api';
import { MarkdownContent } from './components/MarkdownContent';
import { useAppDataContext } from './contexts/AppDataContext';
import type { KnowledgeAnswer, Task } from './types';

export function KnowledgeBase({
  onSelectTask,
}: {
  onSelectTask: (taskId: string) => void;
}) {
  const { tasks, notebooks, userSettings } = useAppDataContext();
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Task[]>([]);
  const [answer, setAnswer] = useState<KnowledgeAnswer | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isAnswering, setIsAnswering] = useState(false);

  const notebookMap = useMemo(
    () => new Map(notebooks.map((notebook) => [notebook.id, notebook.name])),
    [notebooks],
  );

  const runSearch = async () => {
    setIsSearching(true);
    try {
      const results = await apiJson<Task[]>(
        `/api/search/tasks?q=${encodeURIComponent(query.trim())}`,
      );
      setSearchResults(results);
    } catch (error) {
      console.error('Failed to search tasks:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const askKnowledgeBase = async () => {
    if (!query.trim()) {
      return;
    }

    setIsAnswering(true);
    try {
      const result = await apiJson<KnowledgeAnswer>('/api/knowledge/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      setAnswer(result);
      if (searchResults.length === 0) {
        await runSearch();
      }
    } catch (error) {
      console.error('Failed to ask knowledge base:', error);
      setAnswer(null);
      alert(error instanceof Error ? error.message : 'Failed to ask knowledge base.');
    } finally {
      setIsAnswering(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-[380px_minmax(0,1fr)] gap-6 h-full">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col min-h-[480px]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center">
            <BrainCircuit className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Knowledge Search</h2>
            <p className="text-sm text-slate-500">Across all transcripts and summaries</p>
          </div>
        </div>

        <div className="space-y-3">
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && query.trim()) {
                void runSearch();
              }
            }}
            placeholder="Search across all recordings..."
            className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
          />
          <div className="flex gap-3">
            <button
              onClick={() => void runSearch()}
              disabled={isSearching || !query.trim()}
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium hover:bg-slate-50 disabled:opacity-50"
              title="Find recordings matching your keywords"
            >
              {isSearching ? 'Searching...' : 'Find recordings'}
            </button>
            <button
              onClick={() => void askKnowledgeBase()}
              disabled={isAnswering || !query.trim()}
              className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
              title="Get an AI-synthesized answer across all recordings"
            >
              {isAnswering ? 'Thinking...' : 'Ask AI'}
            </button>
          </div>
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4 flex-1 overflow-y-auto custom-scrollbar">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-3">
            <Search className="w-4 h-4" />
            Search Results
          </div>

          {searchResults.length === 0 ? (
            <div className="text-sm text-slate-500 space-y-3">
              {query.trim() ? (
                <p>No results yet. Try searching or asking AI.</p>
              ) : (
                <>
                  <p>{tasks.length} recording{tasks.length !== 1 ? 's' : ''} available for search.</p>
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Try asking</p>
                    {['What key decisions were made recently?', 'Summarize discussions about the project timeline', 'What action items were mentioned?'].map((example) => (
                      <button
                        key={example}
                        type="button"
                        onClick={() => setQuery(example)}
                        className="block w-full text-left text-xs text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 px-2.5 py-1.5 rounded-lg transition-colors"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {searchResults.map((task) => (
                <button
                  key={task.id}
                  onClick={() => onSelectTask(task.id)}
                  className="w-full text-left p-3 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{task.originalName}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        {task.notebookId ? notebookMap.get(task.notebookId) || 'Notebook' : 'Unassigned'}
                        {typeof task.score === 'number' ? ` • score ${task.score}` : ''}
                      </p>
                      {typeof task.metadata?.searchSnippet === 'string' && (
                        <p className="text-xs text-slate-500 mt-2">{String(task.metadata.searchSnippet)}</p>
                      )}
                    </div>
                    <span className="text-[10px] uppercase tracking-wide text-slate-400">{task.status}</span>
                  </div>
                  {task.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {task.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 min-h-[480px] overflow-y-auto custom-scrollbar">
        {!answer ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-slate-500">
            {isAnswering ? (
              <>
                <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
                <p>Generating cross-recording answer...</p>
              </>
            ) : (
              <>
                <BrainCircuit className="w-12 h-12 text-slate-300 mb-4" />
                <p className="text-base font-medium text-slate-700">Ask across all your recordings</p>
                <p className="text-sm mt-2 max-w-lg">
                  This will retrieve relevant chunks and use the configured LLM to answer from indexed transcript segments.
                </p>
                <p className="text-xs mt-3 text-slate-400">
                  Retrieval mode: {userSettings?.retrievalMode || 'hybrid'}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <MarkdownContent
              content={answer.answer}
              proseClassName="prose prose-slate max-w-none prose-headings:font-semibold"
            />

            <div className="border-t border-slate-100 pt-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-3">Sources</h3>
              <p className="text-xs text-slate-500 mb-3">
                Mode: {answer.retrieval.mode} • chunks used: {answer.retrieval.chunkCount} • embeddings: {answer.retrieval.embeddings.configured ? answer.retrieval.embeddings.model : 'disabled'}
              </p>
              <div className="grid md:grid-cols-2 gap-3">
                {answer.sources.map((source) => (
                  <div key={source.id} className="rounded-xl border border-slate-200 p-4 bg-slate-50">
                    <p className="text-sm font-medium text-slate-900">{source.originalName}</p>
                    <p className="text-xs text-slate-500 mt-1">{source.notebookName || 'Unassigned notebook'}</p>
                    {source.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {source.tags.map((tag) => (
                          <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-white text-slate-600 border border-slate-200">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {source.snippet && <p className="text-xs text-slate-500 mt-3">{source.snippet}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
