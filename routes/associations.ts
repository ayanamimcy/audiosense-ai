import express from 'express';
import { getRelatedTasks, computeTaskAssociations } from '../lib/association-service.js';
import { asyncRoute, requireAuthUser } from './middleware.js';

const router = express.Router();

router.get('/tasks/:id/related', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const related = await getRelatedTasks(user.id, req.params.id, 5);
  return res.json(related);
}));

router.post('/knowledge/analyze', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const result = await computeTaskAssociations(user.id);
  return res.json(result || { computed: 0, associations: 0 });
}));

export const associationsRouter = router;
