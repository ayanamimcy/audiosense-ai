import express from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../db.js';
import { repairPossiblyMojibakeText } from '../lib/text-encoding.js';
import { enqueueTaskJob } from '../lib/task-queue.js';
import {
  clearTaskIndex,
  reindexTask,
} from '../lib/search-index.js';
import {
  normalizeTags,
  toTaskListResponse,
  toTaskResponse,
  type TaskMessageRow,
  type TaskRow,
} from '../lib/task-types.js';
import { findTaskForUser } from '../lib/task-helpers.js';
import { createUploadTask } from '../lib/upload-service.js';
import { asyncRoute, requireAuthUser, upload, uploadDir } from './middleware.js';

const router = express.Router();

router.post('/upload', upload.single('audio'), asyncRoute(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file uploaded.' });
  }

  const user = requireAuthUser(req);
  try {
    const taskId = await createUploadTask({
      userId: user.id,
      file: req.file,
      body: req.body,
    });
    return res.json({ taskId, message: 'Upload successful, task queued.' });
  } catch (error) {
    console.error('Failed to create task:', error);
    return res.status(500).json({ error: 'Database error while creating task.' });
  }
}));

router.post('/tasks/:id/reprocess', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const task = await findTaskForUser(user.id, req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found.' });
  }

  const provider = String(
    req.body.provider || task.provider || process.env.TRANSCRIPTION_PROVIDER || 'local-python',
  );
  await db('tasks').where({ id: task.id }).update({
    status: 'pending',
    summary: null,
    result: null,
    updatedAt: Date.now(),
  });
  await enqueueTaskJob({ taskId: task.id, userId: user.id, provider });

  return res.json({ success: true });
}));

router.get('/tasks', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const tasks = ((await db('tasks')
    .where({ userId: user.id })
    .orderBy('createdAt', 'desc')) as TaskRow[]).map(toTaskListResponse);
  return res.json(tasks);
}));

router.get('/tasks/:id', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const task = await findTaskForUser(user.id, req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found.' });
  }

  return res.json(toTaskResponse(task));
}));

router.patch('/tasks/:id', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const task = await findTaskForUser(user.id, req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found.' });
  }

  const updates: Partial<TaskRow> = {
    updatedAt: Date.now(),
  };
  if (req.body.originalName !== undefined) {
    updates.originalName = repairPossiblyMojibakeText(String(req.body.originalName).trim());
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
}));

router.delete('/tasks/:id', asyncRoute(async (req, res) => {
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
}));

router.get('/tasks/:id/messages', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const task = await findTaskForUser(user.id, req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found.' });
  }

  const messages = (await db('task_messages')
    .where({ taskId: task.id })
    .orderBy('createdAt', 'asc')) as TaskMessageRow[];
  return res.json(messages);
}));

export const tasksRouter = router;
