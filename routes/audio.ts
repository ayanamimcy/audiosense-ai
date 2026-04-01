import express from 'express';
import fs from 'fs';
import path from 'path';
import parseRange from 'range-parser';
import { findTaskRowByFilenameForUser } from '../database/repositories/tasks-repository.js';
import { requireAuthUser, uploadDir } from './middleware.js';

const MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
};

/**
 * Pipe a ReadStream to the response with proper error + client-abort cleanup.
 */
function pipeWithErrorHandling(
  stream: fs.ReadStream,
  res: express.Response,
  next: express.NextFunction,
) {
  stream.on('error', (err) => {
    stream.destroy();
    if (!res.headersSent) {
      next(err);
    }
  });
  res.on('close', () => {
    stream.destroy();
  });
  stream.pipe(res);
}

const router = express.Router();

// Use a raw handler (not asyncRoute) so we have access to `next` for stream errors.
router.get('/audio/:filename', (req, res, next) => {
  void (async () => {
    try {
      const user = requireAuthUser(req);
      const task = await findTaskRowByFilenameForUser(user.id, req.params.filename);
      if (!task) {
        return res.status(404).send('File not found');
      }

      const filePath = path.resolve(uploadDir, req.params.filename);
      if (!filePath.startsWith(uploadDir + path.sep) && filePath !== uploadDir) {
        return res.status(400).send('Invalid filename');
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        return res.status(404).send('File not found');
      }

      const fileSize = stat.size;
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.setHeader('Accept-Ranges', 'bytes');

      const rangeHeader = req.headers.range;
      if (rangeHeader) {
        const ranges = parseRange(fileSize, rangeHeader, { combine: true });

        if (ranges === -1) {
          res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
          return res.end();
        }

        if (ranges !== -2 && ranges.type === 'bytes' && ranges.length > 0) {
          const { start, end } = ranges[0];
          const chunkSize = end - start + 1;

          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
          res.setHeader('Content-Length', chunkSize);
          res.setHeader('Content-Type', contentType);

          return pipeWithErrorHandling(
            fs.createReadStream(filePath, { start, end }),
            res,
            next,
          );
        }
      }

      // No Range or unsatisfiable — stream entire file
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Content-Type', contentType);
      return pipeWithErrorHandling(fs.createReadStream(filePath), res, next);
    } catch (error) {
      next(error);
    }
  })();
});

export const audioRouter = router;
