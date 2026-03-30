import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db.js';
import { parseJsonField, type TaskRow } from '../lib/task-types.js';
import { asyncRoute, requireAuthUser } from './middleware.js';

const router = express.Router();

router.get('/notebooks', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const notebooks = await db('notebooks').where({ userId: user.id }).orderBy('createdAt', 'desc');
  return res.json(notebooks);
}));

router.post('/notebooks', asyncRoute(async (req, res) => {
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
}));

router.patch('/notebooks/:id', asyncRoute(async (req, res) => {
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
}));

router.delete('/notebooks/:id', asyncRoute(async (req, res) => {
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
}));

router.get('/tags', asyncRoute(async (req, res) => {
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
}));

export const notebooksRouter = router;
