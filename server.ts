import 'dotenv/config';

import cors from 'cors';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createServer as createViteServer } from 'vite';
import { db, initDb } from './db.js';
import {
  authenticateUser,
  createSession,
  createUser,
  destroySession,
  getSessionCookieName,
  getSessionUser,
  readCookie,
  serializeClearedSessionCookie,
  serializeSessionCookie,
  type AuthUser,
} from './lib/auth.js';
import {
  answerAcrossKnowledgeBase,
  chatWithTranscript,
  generateTaskSummary,
  getLlmInfo,
  isLlmConfigured,
  type LlmMessage,
} from './lib/llm.js';
import { getEmbeddingsInfo } from './lib/embeddings.js';
import { resetProviderCircuit } from './lib/provider-routing.js';
import {
  clearTaskIndex,
  reindexTask,
  searchChunksHybrid,
} from './lib/search-index.js';
import {
  getDefaultSettings,
  getProviderHealth,
  getUserSettings,
  saveUserSettings,
} from './lib/settings.js';
import { enqueueTaskJob } from './lib/task-queue.js';
import { getAvailableTranscriptionProviders } from './lib/transcription.js';
import {
  normalizeTags,
  parseJsonField,
  toTaskResponse,
  type TaskMessageRow,
  type TaskRow,
} from './lib/task-types.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const configuredUploadDir = process.env.UPLOAD_DIR?.trim();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const uploadDir = path.resolve(configuredUploadDir || path.join(process.cwd(), 'uploads'));
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  },
});

const upload = multer({ storage });

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

function setSessionCookie(res: express.Response, token: string) {
  res.setHeader('Set-Cookie', serializeSessionCookie(token));
}

function clearSessionCookie(res: express.Response) {
  res.setHeader('Set-Cookie', serializeClearedSessionCookie());
}

async function authenticateRequest(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const token = readCookie(req.headers.cookie, getSessionCookieName());
  const session = await getSessionUser(token);
  if (!session) {
    clearSessionCookie(res);
    return res.status(401).json({ error: 'Authentication required.' });
  }

  req.authUser = session.user;
  return next();
}

function requireAuthUser(req: express.Request) {
  if (!req.authUser) {
    throw new Error('Authenticated user is missing from request context.');
  }

  return req.authUser;
}

async function findTaskForUser(userId: string, taskId: string) {
  return (await db('tasks').where({ id: taskId, userId }).first()) as TaskRow | undefined;
}

function buildTaskContext(task: TaskRow) {
  return {
    title: task.originalName,
    transcript: task.transcript || '',
    language: task.language,
    speakers: parseJsonField(task.speakers, []),
  };
}

function scoreTask(query: string, task: ReturnType<typeof toTaskResponse>) {
  const normalizedQuery = query.toLowerCase();
  let score = 0;

  if (task.originalName.toLowerCase().includes(normalizedQuery)) {
    score += 5;
  }
  if (task.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery))) {
    score += 4;
  }
  if ((task.summary || '').toLowerCase().includes(normalizedQuery)) {
    score += 3;
  }
  if ((task.transcript || '').toLowerCase().includes(normalizedQuery)) {
    score += 2;
  }
  if ((task.notebookId || '').toLowerCase().includes(normalizedQuery)) {
    score += 1;
  }

  return score;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.post('/api/auth/register', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!name || !email || password.length < 8) {
    return res.status(400).json({ error: 'Name, email, and password (min 8 chars) are required.' });
  }

  try {
    const user = await createUser({ name, email, password });
    const token = await createSession(user.id);
    setSessionCookie(res, token);
    return res.json({ user });
  } catch (error: unknown) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to create account.',
    });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = await authenticateUser(email, password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = await createSession(user.id);
  setSessionCookie(res, token);
  return res.json({ user });
});

app.get('/api/auth/me', authenticateRequest, async (req, res) => {
  return res.json({ user: requireAuthUser(req) });
});

app.post('/api/auth/logout', async (req, res) => {
  const token = readCookie(req.headers.cookie, getSessionCookieName());
  await destroySession(token);
  clearSessionCookie(res);
  return res.json({ success: true });
});

const protectedApi = express.Router();
protectedApi.use(authenticateRequest);

protectedApi.get('/capabilities', (req, res) => {
  res.json({
    auth: {
      type: 'session-cookie',
      userId: requireAuthUser(req).id,
    },
    transcription: {
      activeProvider: (process.env.TRANSCRIPTION_PROVIDER || 'whisperx').toLowerCase(),
      providers: getAvailableTranscriptionProviders(),
      diarizationSupported: true,
    },
    queue: {
      workerMode: 'separate-process',
      recommendedCommand: 'npm run worker',
    },
    llm: getLlmInfo(),
    embeddings: getEmbeddingsInfo(),
  });
});

protectedApi.get('/settings', async (req, res) => {
  const user = requireAuthUser(req);
  return res.json({
    settings: await getUserSettings(user.id),
    defaults: getDefaultSettings(),
  });
});

protectedApi.patch('/settings', async (req, res) => {
  const user = requireAuthUser(req);
  const settings = await saveUserSettings(user.id, req.body || {});
  return res.json({ settings });
});

protectedApi.get('/provider-health', async (_req, res) => {
  return res.json(await getProviderHealth());
});

protectedApi.post('/provider-health/:provider/reset', async (req, res) => {
  await resetProviderCircuit(String(req.params.provider));
  return res.json({ success: true });
});

protectedApi.post('/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file uploaded.' });
  }

  const user = requireAuthUser(req);
  const now = Date.now();
  const taskId = uuidv4();
  const userSettings = await getUserSettings(user.id);
  const diarizationEnabled = req.body.diarization !== 'false';
  const wordTimestampsEnabled = req.body.wordTimestamps === 'true';
  const translationEnabled = req.body.translationEnabled === 'true';
  const translationTargetLanguage = req.body.translationTargetLanguage
    ? String(req.body.translationTargetLanguage).trim()
    : null;
  const parsedExpectedSpeakers =
    req.body.expectedSpeakers !== undefined && req.body.expectedSpeakers !== ''
      ? Number(req.body.expectedSpeakers)
      : null;
  const expectedSpeakers = Number.isFinite(parsedExpectedSpeakers) ? parsedExpectedSpeakers : null;
  const provider = String(
    req.body.provider || userSettings.defaultProvider || process.env.TRANSCRIPTION_PROVIDER || 'whisperx',
  ).toLowerCase();
  const task: TaskRow = {
    id: taskId,
    userId: user.id,
    filename: req.file.filename,
    originalName: req.body.originalName?.trim() || req.file.originalname,
    status: 'pending',
    createdAt: now,
    notebookId: req.body.notebookId || null,
    tags: JSON.stringify(normalizeTags(req.body.tags)),
    language: req.body.language || 'auto',
    provider,
    sourceType: req.body.sourceType || 'upload',
    eventDate: req.body.eventDate ? Number(req.body.eventDate) : now,
    metadata: JSON.stringify({
      diarization: diarizationEnabled,
      wordTimestamps: wordTimestampsEnabled,
      translationEnabled,
      translationTargetLanguage,
      expectedSpeakers,
      originalMimeType: req.file.mimetype,
      size: req.file.size,
    }),
    updatedAt: now,
  };

  try {
    await db('tasks').insert(task);
    await enqueueTaskJob({
      taskId,
      userId: user.id,
      provider,
      payload: {
        language: task.language,
        diarization: diarizationEnabled,
        wordTimestamps: wordTimestampsEnabled,
        task: translationEnabled ? 'translate' : 'transcribe',
        translationTargetLanguage,
        expectedSpeakers,
      },
    });

    return res.json({ taskId, message: 'Upload successful, task queued.' });
  } catch (error) {
    console.error('Failed to create task:', error);
    return res.status(500).json({ error: 'Database error while creating task.' });
  }
});

protectedApi.post('/tasks/:id/reprocess', async (req, res) => {
  const user = requireAuthUser(req);
  const task = await findTaskForUser(user.id, req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found.' });
  }

  const provider = String(req.body.provider || task.provider || process.env.TRANSCRIPTION_PROVIDER || 'whisperx');
  await db('tasks').where({ id: task.id }).update({
    status: 'pending',
    summary: null,
    result: null,
    updatedAt: Date.now(),
  });
  await enqueueTaskJob({ taskId: task.id, userId: user.id, provider });

  return res.json({ success: true });
});

protectedApi.get('/tasks', async (req, res) => {
  const user = requireAuthUser(req);
  const tasks = ((await db('tasks')
    .where({ userId: user.id })
    .orderBy('createdAt', 'desc')) as TaskRow[]).map(toTaskResponse);
  return res.json(tasks);
});

protectedApi.get('/tasks/:id', async (req, res) => {
  const user = requireAuthUser(req);
  const task = await findTaskForUser(user.id, req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found.' });
  }

  return res.json(toTaskResponse(task));
});

protectedApi.patch('/tasks/:id', async (req, res) => {
  const user = requireAuthUser(req);
  const task = await findTaskForUser(user.id, req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found.' });
  }

  const updates: Partial<TaskRow> = {
    updatedAt: Date.now(),
  };
  if (req.body.originalName !== undefined) {
    updates.originalName = String(req.body.originalName).trim();
  }
  if (req.body.tags !== undefined) {
    updates.tags = JSON.stringify(normalizeTags(req.body.tags));
  }
  if (req.body.notebookId !== undefined) {
    updates.notebookId = req.body.notebookId || null;
  }
  if (req.body.eventDate !== undefined) {
    updates.eventDate = req.body.eventDate ? Number(req.body.eventDate) : null;
  }
  if (req.body.summary !== undefined) {
    updates.summary = req.body.summary ? String(req.body.summary) : null;
  }

  await db('tasks').where({ id: task.id, userId: user.id }).update(updates);
  const updatedTask = (await db('tasks').where({ id: task.id }).first()) as TaskRow;
  if (updatedTask.status === 'completed' && updatedTask.transcript) {
    await reindexTask(updatedTask);
  }
  return res.json(toTaskResponse(updatedTask));
});

protectedApi.delete('/tasks/:id', async (req, res) => {
  const user = requireAuthUser(req);
  const task = await findTaskForUser(user.id, req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found.' });
  }

  const filePath = path.join(uploadDir, task.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  await clearTaskIndex(task.id);
  await db('task_jobs').where({ taskId: task.id }).delete();
  await db('task_messages').where({ taskId: task.id }).delete();
  await db('tasks').where({ id: task.id, userId: user.id }).delete();
  return res.json({ success: true });
});

protectedApi.get('/notebooks', async (req, res) => {
  const user = requireAuthUser(req);
  const notebooks = await db('notebooks').where({ userId: user.id }).orderBy('createdAt', 'desc');
  return res.json(notebooks);
});

protectedApi.post('/notebooks', async (req, res) => {
  const user = requireAuthUser(req);
  const name = String(req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Name is required.' });
  }

  const notebook = {
    id: uuidv4(),
    userId: user.id,
    name,
    description: req.body.description ? String(req.body.description).trim() : null,
    color: req.body.color ? String(req.body.color).trim() : '#4f46e5',
    createdAt: Date.now(),
  };

  await db('notebooks').insert(notebook);
  return res.json(notebook);
});

protectedApi.patch('/notebooks/:id', async (req, res) => {
  const user = requireAuthUser(req);
  const notebook = await db('notebooks').where({ id: req.params.id, userId: user.id }).first();
  if (!notebook) {
    return res.status(404).json({ error: 'Notebook not found.' });
  }

  const updates = {
    name: req.body.name ? String(req.body.name).trim() : notebook.name,
    description: req.body.description !== undefined ? req.body.description : notebook.description,
    color: req.body.color !== undefined ? req.body.color : notebook.color,
  };

  await db('notebooks').where({ id: req.params.id, userId: user.id }).update(updates);
  const updated = await db('notebooks').where({ id: req.params.id }).first();
  return res.json(updated);
});

protectedApi.delete('/notebooks/:id', async (req, res) => {
  const user = requireAuthUser(req);
  const deleted = await db('notebooks').where({ id: req.params.id, userId: user.id }).delete();
  if (!deleted) {
    return res.status(404).json({ error: 'Notebook not found.' });
  }

  await db('tasks').where({ userId: user.id, notebookId: req.params.id }).update({
    notebookId: null,
    updatedAt: Date.now(),
  });
  return res.json({ success: true });
});

protectedApi.get('/tags', async (req, res) => {
  const user = requireAuthUser(req);
  const tasks = (await db('tasks').where({ userId: user.id }).select('tags')) as Pick<TaskRow, 'tags'>[];
  const counts = new Map<string, number>();

  for (const task of tasks) {
    for (const tag of parseJsonField<string[]>(task.tags, [])) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }

  return res.json(
    Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  );
});

protectedApi.get('/tasks/:id/messages', async (req, res) => {
  const user = requireAuthUser(req);
  const task = await findTaskForUser(user.id, req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found.' });
  }

  const messages = (await db('task_messages')
    .where({ taskId: task.id })
    .orderBy('createdAt', 'asc')) as TaskMessageRow[];
  return res.json(messages);
});

protectedApi.post('/tasks/:id/summary', async (req, res) => {
  const user = requireAuthUser(req);
  const task = await findTaskForUser(user.id, req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found.' });
  }
  if (!task.transcript) {
    return res.status(400).json({ error: 'Task transcript is not ready yet.' });
  }
  if (!isLlmConfigured()) {
    return res.status(400).json({ error: 'LLM API is not configured.' });
  }

  try {
    const summary = await generateTaskSummary(buildTaskContext(task), req.body.instructions);
    await db('tasks').where({ id: task.id, userId: user.id }).update({
      summary,
      updatedAt: Date.now(),
    });
    const updated = (await db('tasks').where({ id: task.id }).first()) as TaskRow;
    await reindexTask(updated);
    return res.json(toTaskResponse(updated));
  } catch (error: unknown) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate summary.',
    });
  }
});

protectedApi.post('/tasks/:id/chat', async (req, res) => {
  const user = requireAuthUser(req);
  const task = await findTaskForUser(user.id, req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found.' });
  }
  if (!task.transcript) {
    return res.status(400).json({ error: 'Task transcript is not ready yet.' });
  }
  if (!isLlmConfigured()) {
    return res.status(400).json({ error: 'LLM API is not configured.' });
  }

  const message = String(req.body.message || '').trim();
  if (!message) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  const history = (await db('task_messages')
    .where({ taskId: task.id })
    .orderBy('createdAt', 'asc')) as TaskMessageRow[];
  const normalizedHistory: LlmMessage[] = history.map((item) => ({
    role: item.role,
    content: item.content,
  }));
  const reply = await chatWithTranscript(buildTaskContext(task), normalizedHistory, message);
  const now = Date.now();

  await db('task_messages').insert([
    {
      id: uuidv4(),
      taskId: task.id,
      role: 'user',
      content: message,
      createdAt: now,
    },
    {
      id: uuidv4(),
      taskId: task.id,
      role: 'assistant',
      content: reply,
      createdAt: now + 1,
    },
  ]);

  const messages = (await db('task_messages')
    .where({ taskId: task.id })
    .orderBy('createdAt', 'asc')) as TaskMessageRow[];
  return res.json(messages);
});

protectedApi.get('/search/tasks', async (req, res) => {
  const user = requireAuthUser(req);
  const query = String(req.query.q || '').trim();
  const tasks = ((await db('tasks')
    .where({ userId: user.id })
    .orderBy('createdAt', 'desc')) as TaskRow[]).map(toTaskResponse);

  if (!query) {
    return res.json(tasks.slice(0, 20));
  }

  const userSettings = await getUserSettings(user.id);
  const ranking = await searchChunksHybrid(user.id, query, {
    retrievalMode: userSettings.retrievalMode,
    maxChunks: userSettings.maxKnowledgeChunks,
  });
  const rankingMap = new Map(ranking.taskRanking.map((item) => [item.taskId, item]));

  const ranked = tasks
    .map((task) => ({
      task,
      score:
        rankingMap.get(task.id)?.score ||
        scoreTask(query, task),
      snippet: rankingMap.get(task.id)?.snippet || '',
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.task.createdAt - a.task.createdAt)
    .slice(0, 20)
    .map((item) => ({
      ...item.task,
      score: item.score,
      metadata: {
        ...(item.task.metadata || {}),
        searchSnippet: item.snippet,
      },
    }));

  return res.json(ranked);
});

protectedApi.post('/knowledge/ask', async (req, res) => {
  const user = requireAuthUser(req);
  const query = String(req.body.query || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'Query is required.' });
  }
  if (!isLlmConfigured()) {
    return res.status(400).json({ error: 'LLM API is not configured.' });
  }

  const allTasks = ((await db('tasks')
    .where({ userId: user.id })
    .orderBy('createdAt', 'desc')) as TaskRow[]).map(toTaskResponse);
  const selectedIds = Array.isArray(req.body.taskIds)
    ? req.body.taskIds.map((value: unknown) => String(value))
    : [];
  const userSettings = await getUserSettings(user.id);
  const retrieval = await searchChunksHybrid(user.id, query, {
    taskIds: selectedIds.length ? selectedIds : undefined,
    retrievalMode: userSettings.retrievalMode,
    maxChunks: userSettings.maxKnowledgeChunks,
  });

  const taskRanking = retrieval.taskRanking;
  const candidateTasks = (selectedIds.length
    ? allTasks.filter((task) => selectedIds.includes(task.id))
    : taskRanking
        .map((item) => allTasks.find((task) => task.id === item.taskId))
        .filter(Boolean)) as typeof allTasks;

  if (candidateTasks.length === 0) {
    return res.status(404).json({ error: 'No matching transcripts found.' });
  }

  const notebooks = await db('notebooks').where({ userId: user.id });
  const notebookMap = new Map(notebooks.map((item) => [item.id, item.name]));
  const chunkMap = new Map(
    retrieval.chunkRanking.map((chunk) => [`${chunk.taskId}:${chunk.chunkId}`, chunk]),
  );
  const answer = await answerAcrossKnowledgeBase(
    query,
    candidateTasks.map((task) => ({
      title: task.originalName,
      transcript:
        retrieval.chunkRanking
          .filter((chunk) => chunk.taskId === task.id)
          .map((chunk) => chunk.content)
          .join('\n\n') || task.transcript || '',
      language: task.language,
      notebook: task.notebookId ? notebookMap.get(task.notebookId) || null : null,
      tags: task.tags,
    })),
  );

  return res.json({
    answer,
    sources: candidateTasks.map((task) => ({
      id: task.id,
      originalName: task.originalName,
      notebookName: task.notebookId ? notebookMap.get(task.notebookId) || null : null,
      tags: task.tags,
      snippet:
        retrieval.chunkRanking.find((chunk) => chunk.taskId === task.id)?.content ||
        taskRanking.find((item) => item.taskId === task.id)?.snippet ||
        '',
    })),
    retrieval: {
      mode: userSettings.retrievalMode,
      embeddings: retrieval.embeddings,
      chunkCount: retrieval.chunkRanking.length,
    },
  });
});

protectedApi.get('/audio/:filename', async (req, res) => {
  const user = requireAuthUser(req);
  const task = (await db('tasks')
    .where({ userId: user.id, filename: req.params.filename })
    .first()) as TaskRow | undefined;
  if (!task) {
    return res.status(404).send('File not found');
  }

  const filePath = path.join(uploadDir, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }

  return res.sendFile(filePath);
});

app.use('/api', protectedApi);

async function startServer() {
  await initDb();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
