import { useEffect, useState } from 'react';
import { FileAudio, Link2, Loader2 } from 'lucide-react';
import { apiJson } from '../../api';

interface RelatedTask {
  id: string;
  originalName: string;
  tags: string[];
  notebookId?: string | null;
  score: number;
}

export function RelatedRecordings({
  taskId,
  onNavigate,
}: {
  taskId: string;
  onNavigate: (taskId: string) => void;
}) {
  const [related, setRelated] = useState<RelatedTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    void apiJson<RelatedTask[]>(`/api/tasks/${taskId}/related`)
      .then(setRelated)
      .catch(() => setRelated([]))
      .finally(() => setIsLoading(false));
  }, [taskId]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400 py-3">
        <Loader2 className="w-4 h-4 animate-spin" />
        Finding related recordings...
      </div>
    );
  }

  if (related.length === 0) return null;

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-3">
        <Link2 className="w-4 h-4" />
        Related Recordings
      </div>
      <div className="space-y-1.5">
        {related.map((task) => (
          <button
            key={task.id}
            type="button"
            onClick={() => onNavigate(task.id)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-left hover:bg-indigo-50 hover:border-indigo-200 transition-colors"
          >
            <FileAudio className="w-4 h-4 text-slate-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-800 truncate">{task.originalName}</p>
              {task.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {task.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <span className="text-[10px] text-slate-400 shrink-0">
              {Math.round(task.score * 100)}%
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
