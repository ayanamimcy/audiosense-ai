import express from 'express';
import {
  applyTaskTagSuggestionsForUser,
  buildTaskSubtitlesForUser,
  dismissTaskTagSuggestionsForUser,
  UserTaskNotFoundError,
  UserTaskTagSuggestionError,
  createUploadTaskForUser,
  generateTaskTagSuggestionsForUser,
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
    return res.status(400).json({ error: 'No media file uploaded.' });
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
    await reprocessTaskForUser(user.id, req.params.id, {
      provider: req.body.provider,
      language: req.body.language,
    });
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

router.get('/tasks/:id/subtitles.vtt', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  try {
    const content = await buildTaskSubtitlesForUser(user.id, req.params.id);
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline');
    return res.send(content);
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

router.post('/tasks/:id/tag-suggestions/generate', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  try {
    return res.json(await generateTaskTagSuggestionsForUser(user.id, req.params.id));
  } catch (error) {
    if (error instanceof UserTaskNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    if (error instanceof UserTaskTagSuggestionError) {
      return res.status(400).json({ error: error.message });
    }
    throw error;
  }
}));

router.post('/tasks/:id/tag-suggestions/apply', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  try {
    return res.json(await applyTaskTagSuggestionsForUser(user.id, req.params.id, req.body || {}));
  } catch (error) {
    if (error instanceof UserTaskNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    if (error instanceof UserTaskTagSuggestionError) {
      return res.status(400).json({ error: error.message });
    }
    throw error;
  }
}));

router.post('/tasks/:id/tag-suggestions/dismiss', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  try {
    return res.json(await dismissTaskTagSuggestionsForUser(user.id, req.params.id));
  } catch (error) {
    if (error instanceof UserTaskNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    if (error instanceof UserTaskTagSuggestionError) {
      return res.status(400).json({ error: error.message });
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
