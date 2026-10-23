import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { apiJson } from '@/shared/api/base';

interface RelatedTask {
  id: string;
  originalName: string;
  score: number;
}

export function RelatedRecordings({ taskId }: { taskId: string }) {
  const { search } = useLocation();
  const [related, setRelated] = useState<RelatedTask[]>([]);

  useEffect(() => {
    let cancelled = false;
    setRelated([]);
    void apiJson<RelatedTask[]>(`/api/tasks/${taskId}/related`)
      .then((items) => {
        if (!cancelled) setRelated(items);
      })
      .catch(() => {
        if (!cancelled) setRelated([]);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (related.length === 0) return null;

  return (
    <section className="mt-8">
      <h3 className="mb-2 text-[13px] font-semibold text-stone-600">Related</h3>
      <div className="flex flex-wrap gap-2">
        {related.map((task) => (
          <Link
            key={task.id}
            to={{ pathname: `/notebook/${task.id}`, search }}
            title={`${Math.round(task.score * 100)}% match`}
            className="max-w-full truncate rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-800 hover:bg-stone-50"
          >
            {task.originalName}
          </Link>
        ))}
      </div>
    </section>
  );
}
