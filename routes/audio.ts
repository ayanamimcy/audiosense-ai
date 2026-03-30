import express from 'express';
import fs from 'fs';
import path from 'path';
import { findTaskRowByFilenameForUser } from '../database/repositories/tasks-repository.js';
import { asyncRoute, requireAuthUser, uploadDir } from './middleware.js';

const router = express.Router();

router.get('/audio/:filename', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const task = await findTaskRowByFilenameForUser(user.id, req.params.filename);
  if (!task) {
    return res.status(404).send('File not found');
  }

  const filePath = path.resolve(uploadDir, req.params.filename);
  if (!filePath.startsWith(uploadDir + path.sep) && filePath !== uploadDir) {
    return res.status(400).send('Invalid filename');
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }

  return res.sendFile(filePath);
}));

export const audioRouter = router;
