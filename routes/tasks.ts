import express from 'express';
import {
  UserTaskNotFoundError,
  createUploadTaskForUser,
  deleteTaskForUserAndCleanup,
  getTaskDetailForUser,
  listTaskMessagesForUser,
  listTasksForUser,
  reprocessTaskForUser,
  updateTaskForUser,
} from '../application/services/tasks-service.js';
import { asyncRoute, requireAuthUser, upload, uploadDir } from './middleware.js';

const router = express.Router();

router.post('/upload', upload.single('audio'), asyncRoute(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file uploaded.' });
  }

  const user = requireAuthUser(req);
  try {
    const taskId = await createUploadTaskForUser({
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
  try {
    await reprocessTaskForUser(user.id, req.params.id, req.body.provider);
    return res.json({ success: true });
  } catch (error) {
    if (error instanceof UserTaskNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    throw error;
  }
}));

router.get('/tasks', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  return res.json(await listTasksForUser(user.id));
}));

router.get('/tasks/:id', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  try {
    return res.json(await getTaskDetailForUser(user.id, req.params.id));
  } catch (error) {
    if (error instanceof UserTaskNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    throw error;
  }
}));

router.patch('/tasks/:id', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  try {
    return res.json(await updateTaskForUser(user.id, req.params.id, req.body || {}));
  } catch (error) {
    if (error instanceof UserTaskNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    throw error;
  }
}));

router.delete('/tasks/:id', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  try {
    await deleteTaskForUserAndCleanup(user.id, req.params.id, uploadDir);
    return res.json({ success: true });
  } catch (error) {
    if (error instanceof UserTaskNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    throw error;
  }
}));

router.get('/tasks/:id/messages', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  try {
    return res.json(await listTaskMessagesForUser(user.id, req.params.id));
  } catch (error) {
    if (error instanceof UserTaskNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    throw error;
  }
}));

export const tasksRouter = router;
