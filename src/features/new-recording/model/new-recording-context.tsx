import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDataContext } from '@/app/providers/app-data-context';
import { NewRecordingDialog } from '../ui/NewRecordingDialog';

export type NewRecordingMode = 'record' | 'upload';

interface OpenOptions {
  /** Pre-selects this notebook in the dialog. */
  notebookId?: string | null;
}

interface NewRecordingContextValue {
  openNewRecording: (mode?: NewRecordingMode, options?: OpenOptions) => void;
}

const NewRecordingContext = createContext<NewRecordingContextValue | null>(null);

export function NewRecordingProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { refreshTasksAndSelection, fetchTags } = useAppDataContext();
  const [dialog, setDialog] = useState<{ mode: NewRecordingMode; notebookId: string } | null>(null);

  const openNewRecording = useCallback((mode: NewRecordingMode = 'record', options?: OpenOptions) => {
    setDialog({ mode, notebookId: options?.notebookId || '' });
  }, []);

  const handleSuccess = useCallback(async (taskId?: string) => {
    setDialog(null);
    await refreshTasksAndSelection(taskId);
    await fetchTags();
    if (taskId) navigate(`/notebook/${taskId}`);
  }, [fetchTags, navigate, refreshTasksAndSelection]);

  const value = useMemo(() => ({ openNewRecording }), [openNewRecording]);

  return (
    <NewRecordingContext.Provider value={value}>
      {children}
      {dialog ? (
        <NewRecordingDialog
          initialMode={dialog.mode}
          initialNotebookId={dialog.notebookId}
          onClose={() => setDialog(null)}
          onSuccess={handleSuccess}
        />
      ) : null}
    </NewRecordingContext.Provider>
  );
}

export function useNewRecording() {
  const context = useContext(NewRecordingContext);
  if (!context) {
    throw new Error('useNewRecording must be used within a NewRecordingProvider');
  }
  return context;
}
