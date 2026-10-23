import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export const RECORDING_NAVIGATION_EVENT = 'audiosense:before-navigation';
/** Destination sent when the New recording dialog closes. */
export const NEW_RECORDING_CLOSE_DESTINATION = 'new-recording:close';
/** Destination sent before signing out — the only in-app action that drops the draft. */
export const LOGOUT_DESTINATION = 'logout';

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
      // The draft lives in app state, so in-app navigation keeps it; only signing out loses it.
      if (destination !== LOGOUT_DESTINATION) return;

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
