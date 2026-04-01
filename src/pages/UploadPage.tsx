import React, { useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { cn, getLocalSetting, LANGUAGE_OPTIONS } from '../lib/utils';
import { isLargeFile, chunkedUpload, directUploadWithProgress, type UploadProgress } from '../lib/chunked-upload';
import { useAppDataContext } from '../contexts/AppDataContext';

const MEDIA_FILE_ACCEPT = 'audio/*,video/*,.m4a,.mp3,.wav,.ogg,.webm,.aac,.mp4,.m4v,.mov,.flac';
const MEDIA_FILE_EXTENSIONS = ['.m4a', '.mp3', '.wav', '.ogg', '.webm', '.aac', '.mp4', '.m4v', '.mov', '.flac'];

function isLikelyMediaFile(file: File) {
  const mimeType = file.type.toLowerCase();
  if (mimeType.startsWith('audio/') || mimeType.startsWith('video/')) {
    return true;
  }

  const lowerName = file.name.toLowerCase();
  return MEDIA_FILE_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

export function UploadPage({
  onUploadSuccess,
}: {
  onUploadSuccess: (taskId?: string) => void | Promise<void>;
}) {
  const { notebooks, capabilities, userSettings } = useAppDataContext();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; filename: string } | null>(null);
  const [filePercent, setFilePercent] = useState<number | null>(null);
  const [uploadPhase, setUploadPhase] = useState<UploadProgress['phase'] | null>(null);
  const [selectedNotebookId, setSelectedNotebookId] = useState('');
  const [tags, setTags] = useState('');
  const [provider, setProvider] = useState('');
  const [language, setLanguage] = useState(() => getLocalSetting('parseLanguage', 'auto'));
  const fileInputRef = useRef<HTMLInputElement>(null);

  const buildMetadata = () => {
    const meta: Record<string, string> = {
      language,
      diarization: getLocalSetting('enableDiarization', 'true'),
      sourceType: 'upload',
    };
    if (selectedNotebookId) meta.notebookId = selectedNotebookId;
    if (tags.trim()) meta.tags = tags;
    if (provider) meta.provider = provider;
    return meta;
  };

  const queueUpload = async (file: File) => {
    setFilePercent(0);
    setUploadPhase(null);

    try {
      if (isLargeFile(file)) {
        // Large file: chunked upload with MD5 + parallel chunks
        return await chunkedUpload(file, buildMetadata(), (progress) => {
          setUploadPhase(progress.phase);
          setFilePercent(progress.percent);
        });
      }

      // Small file: direct upload with XHR progress
      const formData = new FormData();
      formData.append('audio', file);
      for (const [key, value] of Object.entries(buildMetadata())) {
        formData.append(key, value);
      }
      return await directUploadWithProgress(formData, (percent) => {
        setUploadPhase('uploading');
        setFilePercent(percent);
      });
    } catch (error: unknown) {
      console.error('Upload error:', error);
      throw error instanceof Error ? error : new Error('Upload failed.');
    } finally {
      setFilePercent(null);
      setUploadPhase(null);
    }
  };

  const handleFiles = async (files: File[]) => {
    const validFiles = files.filter((file) => isLikelyMediaFile(file));
    const invalidFiles = files.filter((file) => !isLikelyMediaFile(file));

    if (invalidFiles.length > 0) {
      alert(`Skipped unsupported files: ${invalidFiles.map((file) => file.name).join(', ')}`);
    }

    if (validFiles.length === 0) {
      return;
    }

    setIsUploading(true);
    const uploadErrors: string[] = [];
    let latestTaskId: string | undefined;

    try {
      for (const [index, file] of validFiles.entries()) {
        setUploadProgress({
          current: index + 1,
          total: validFiles.length,
          filename: file.name,
        });

        try {
          const taskId = await queueUpload(file);
          if (taskId) {
            latestTaskId = taskId;
          }
        } catch (error: unknown) {
          uploadErrors.push(`${file.name}: ${error instanceof Error ? error.message : 'Upload failed.'}`);
        }
      }

      if (latestTaskId) {
        setTags('');
        await onUploadSuccess(latestTaskId);
      }

      if (uploadErrors.length > 0) {
        alert(`Some files could not be queued:\n${uploadErrors.join('\n')}`);
      }
    } finally {
      setUploadProgress(null);
      setIsUploading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Upload Audio or Video</h2>
      <div
        className={cn(
          'border-2 border-dashed rounded-xl p-8 text-center transition-colors duration-200 flex flex-col items-center justify-center min-h-[240px]',
          isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:border-slate-400 bg-slate-50',
          isUploading && 'opacity-50 pointer-events-none',
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          const droppedFiles = Array.from(event.dataTransfer.files);
          if (droppedFiles.length > 0) {
            void handleFiles(droppedFiles);
          }
        }}
      >
        {isUploading ? <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-4" /> : <Upload className="w-10 h-10 text-slate-400 mb-4" />}
        <p className="text-sm font-medium text-slate-700 mb-1">
          {isUploading
            ? uploadProgress
              ? `Uploading ${uploadProgress.current}/${uploadProgress.total}: ${uploadProgress.filename}`
              : 'Preparing upload...'
            : 'Drag your media files here'}
        </p>
        {isUploading && filePercent !== null ? (
          <div className="w-full max-w-xs mt-2 mb-4">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
              <span>
                {uploadPhase === 'hashing' ? 'Calculating checksum...' : uploadPhase === 'merging' ? 'Merging chunks...' : 'Uploading...'}
              </span>
              <span>{filePercent}%</span>
            </div>
            <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                style={{ width: `${filePercent}%` }}
              />
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500 mb-4">Supports batch upload for MP3, WAV, M4A, OGG, WEBM, AAC, MP4, MOV, M4V, and FLAC</p>
        )}
        <input
          type="file"
          multiple
          accept={MEDIA_FILE_ACCEPT}
          className="hidden"
          ref={fileInputRef}
          onChange={(event) => {
            const selectedFiles = Array.from(event.target.files || []);
            if (selectedFiles.length > 0) {
              void handleFiles(selectedFiles);
            }
            event.target.value = '';
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
        >
          Browse Files
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 mt-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Provider</span>
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">
              Default ({userSettings?.defaultProvider || capabilities?.transcription.activeProvider || 'local-python'})
            </option>
            {capabilities?.transcription.providers.map((item) => (
              <option key={item.id} value={item.id} disabled={!item.configured}>
                {item.label}{item.configured ? '' : ' (Not configured)'}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Language</span>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Notebook</span>
          <select
            value={selectedNotebookId}
            onChange={(event) => setSelectedNotebookId(event.target.value)}
            className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Unassigned</option>
            {notebooks.map((notebook) => (
              <option key={notebook.id} value={notebook.id}>
                {notebook.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Tags</span>
          <input
            type="text"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="meeting, interview, sprint"
            className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
      </div>
    </div>
  );
}
