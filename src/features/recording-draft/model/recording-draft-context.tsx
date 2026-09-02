import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export const RECORDING_NAVIGATION_EVENT = 'audiosense:before-navigation';

interface RecordingDraftContextValue {
  pendingRecording: File | null;
  setPendingRecording: (recording: File | null) => void;
}

const RecordingDraftContext = createContext<RecordingDraftContextValue | null>(null);

export function RecordingDraftProvider({ children }: { children: React.ReactNode }) {
  const [pendingRecording, setPendingRecording] = useState<File | null>(null);

  useEffect(() => {
    if (!pendingRecording) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = true;
    };
    const handleNavigationAttempt = (event: Event) => {
      const destination = event instanceof CustomEvent
        ? String((event.detail as { destination?: string } | undefined)?.destination || '')
        : '';
      if (destination === '/record') return;

      const confirmed = window.confirm(
        'A recording is waiting to upload and is only stored in this browser tab. Download it before signing out or closing the app. Continue?',
      );
      if (!confirmed) {
        event.preventDefault();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener(RECORDING_NAVIGATION_EVENT, handleNavigationAttempt);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener(RECORDING_NAVIGATION_EVENT, handleNavigationAttempt);
    };
  }, [pendingRecording]);

  const value = useMemo(
    () => ({ pendingRecording, setPendingRecording }),
    [pendingRecording],
  );

  return (
    <RecordingDraftContext.Provider value={value}>
      {children}
    </RecordingDraftContext.Provider>
  );
}

export function useRecordingDraft() {
  const context = useContext(RecordingDraftContext);
  if (!context) {
    throw new Error('useRecordingDraft must be used within a RecordingDraftProvider');
  }
  return context;
}
