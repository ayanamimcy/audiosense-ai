import SparkMD5 from 'spark-md5';
import { apiFetch } from '@/shared/api/base';

const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB — must match server
const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024; // 50 MB
const MAX_CONCURRENT = 3;

export function isLargeFile(file: File) {
  return file.size > LARGE_FILE_THRESHOLD;
}

export interface UploadProgress {
  phase: 'hashing' | 'uploading' | 'merging';
  /** 0–100 */
  percent: number;
}

function computeFileMd5(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const spark = new SparkMD5.ArrayBuffer();
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    let currentChunk = 0;

    const reader = new FileReader();

    reader.onload = (e) => {
      if (e.target?.result) {
        spark.append(e.target.result as ArrayBuffer);
      }
      currentChunk++;
      onProgress?.(Math.round((currentChunk / totalChunks) * 100));

      if (currentChunk < totalChunks) {
        setTimeout(loadNext, 0);
      } else {
        resolve(spark.end());
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file for MD5 calculation.'));

    function loadNext() {
      const start = currentChunk * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      reader.readAsArrayBuffer(file.slice(start, end));
    }

    loadNext();
  });
}

function uploadChunk(
  uploadId: string,
  chunkIndex: number,
  chunkBlob: Blob,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('uploadId', uploadId);
    formData.append('chunkIndex', String(chunkIndex));
    formData.append('chunk', chunkBlob);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload/chunk');
    xhr.withCredentials = true;
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Chunk ${chunkIndex} upload failed: ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error(`Chunk ${chunkIndex} network error.`));
    xhr.send(formData);
  });
}

export async function chunkedUpload(
  file: File,
  metadata: Record<string, string>,
  onProgress: (progress: UploadProgress) => void,
): Promise<string> {
  onProgress({ phase: 'hashing', percent: 0 });
  const fileMd5 = await computeFileMd5(file, (p) => {
    onProgress({ phase: 'hashing', percent: Math.round(p * 0.1) });
  });
  onProgress({ phase: 'hashing', percent: 10 });

  const initRes = await apiFetch('/api/upload/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      totalSize: file.size,
      fileMd5,
    }),
  });
  if (!initRes.ok) {
    const err = await initRes.json().catch(() => null);
    throw new Error(err?.error || 'Failed to initialize upload.');
  }
  const initData = await initRes.json() as {
    uploadId: string;
    totalChunks: number;
    uploadedChunkIndexes: number[];
    taskId?: string;
    alreadyMerged?: boolean;
  };

  if (initData.alreadyMerged && initData.taskId) {
    onProgress({ phase: 'merging', percent: 100 });
    return initData.taskId;
  }

  const { uploadId, totalChunks, uploadedChunkIndexes } = initData;

  const alreadyUploaded = new Set(uploadedChunkIndexes);
  const pendingIndexes = Array.from({ length: totalChunks }, (_, i) => i).filter(
    (i) => !alreadyUploaded.has(i),
  );

  let completedCount = alreadyUploaded.size;
  const updateUploadProgress = () => {
    const chunkPercent = completedCount / totalChunks;
    onProgress({ phase: 'uploading', percent: Math.round(10 + chunkPercent * 80) });
  };
  updateUploadProgress();

  const executing: Promise<void>[] = [];
  for (const idx of pendingIndexes) {
    const start = idx * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const blob = file.slice(start, end);

    const task = uploadChunk(uploadId, idx, blob).then(() => {
      completedCount++;
      updateUploadProgress();
      executing.splice(executing.indexOf(task), 1);
    });
    executing.push(task);

    if (executing.length >= MAX_CONCURRENT) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);

  onProgress({ phase: 'uploading', percent: 90 });

  onProgress({ phase: 'merging', percent: 90 });
  const mergeRes = await apiFetch('/api/upload/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId, ...metadata }),
  });
  if (!mergeRes.ok) {
    const err = await mergeRes.json().catch(() => null);
    throw new Error(err?.error || 'Failed to merge upload.');
  }

  const { taskId } = await mergeRes.json() as { taskId: string };
  onProgress({ phase: 'merging', percent: 100 });
  return taskId;
}

export function directUploadWithProgress(
  formData: FormData,
  onProgress: (percent: number) => void,
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.withCredentials = true;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const payload = JSON.parse(xhr.responseText);
          resolve(payload?.taskId ? String(payload.taskId) : undefined);
        } catch {
          resolve(undefined);
        }
      } else {
        try {
          const payload = JSON.parse(xhr.responseText);
          reject(new Error(payload?.error || `Upload failed: ${xhr.status}`));
        } catch {
          reject(new Error(`Upload failed: ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.send(formData);
  });
}
