import React, { useState } from 'react';
import { format } from 'date-fns';
import { X } from 'lucide-react';
import { apiFetch } from '../api';
import { useAppDataContext } from '../contexts/AppDataContext';
import type { Task } from '../types';

export function TaskEditModal({
  task,
  onClose,
  onSaved,
}: {
  task: Task;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { notebooks } = useAppDataContext();
  const [name, setName] = useState(task.originalName);
  const [notebookId, setNotebookId] = useState<string>(task.notebookId || '');
  const [date, setDate] = useState(format(new Date(task.eventDate || task.createdAt), 'yyyy-MM-dd'));
  const [tags, setTags] = useState(task.tags.join(', '));

  const handleSave = async () => {
    if (!name.trim()) return;

    const eventDateTimestamp = date ? new Date(date).getTime() : task.eventDate || task.createdAt;

    try {
      const res = await apiFetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalName: name.trim(),
          notebookId: notebookId || null,
          eventDate: eventDateTimestamp,
          tags,
        }),
      });

      if (!res.ok) throw new Error('Failed to update task.');
      onClose();
      await onSaved();
    } catch (error) {
      console.error('Failed to update task:', error);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Edit Task</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Task Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notebook</label>
            <select
              value={notebookId}
              onChange={(e) => setNotebookId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              <option value="">None</option>
              {notebooks.map((nb) => (
                <option key={nb.id} value={nb.id}>{nb.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Tags</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              placeholder="meeting, research"
            />
          </div>
        </div>
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors">
            Cancel
          </button>
          <button onClick={() => void handleSave()} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
