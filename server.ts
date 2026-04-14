import 'dotenv/config';

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { initDb } from './db.js';
import config from './lib/config.js';
import logger from './lib/shared/logger.js';

const log = logger.child('server');
import type { AuthUser } from './lib/auth/auth.js';
import { authenticateRequest } from './routes/middleware.js';
import { asyncRoute } from './routes/middleware.js';
import { authRouter } from './routes/auth.js';
import { settingsRouter } from './routes/settings.js';
import { tasksRouter } from './routes/tasks.js';
import { chatRouter } from './routes/chat.js';
import { notebooksRouter } from './routes/notebooks.js';
import { searchRouter } from './routes/search.js';
import { audioRouter } from './routes/audio.js';
import { chunkedUploadRouter } from './routes/chunked-upload.js';
import { apiTokensRouter } from './routes/api-tokens.js';
import { knowledgeRouter } from './routes/knowledge.js';
import { associationsRouter } from './routes/associations.js';
import { workspacesRouter } from './routes/workspaces.js';

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
      authSessionId?: string;
      authTokenId?: string;
    }
  }
}

const app = express();
const PORT = config.server.port;

app.set('trust proxy', config.server.trustProxy);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors(
    config.server.corsOrigin
      ? { origin: config.server.corsOrigin, credentials: true }
      : undefined,
  ),
);
app.use(express.json({ limit: '2mb' }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/auth', authLimiter);

// --- Public routes ---
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.get('/api/public-config', (_req, res) => {
  res.json({
    auth: {
      allowRegistration: config.server.allowRegistration,
    },
  });
});

app.use('/api/auth', authRouter);

// --- Protected routes ---
const protectedApi = express.Router();
protectedApi.use(asyncRoute(authenticateRequest));
protectedApi.use(settingsRouter);
protectedApi.use(tasksRouter);
protectedApi.use(chatRouter);
protectedApi.use(notebooksRouter);
protectedApi.use(searchRouter);
protectedApi.use(audioRouter);
protectedApi.use(chunkedUploadRouter);
protectedApi.use(apiTokensRouter);
protectedApi.use(knowledgeRouter);
protectedApi.use(associationsRouter);
protectedApi.use(workspacesRouter);
app.use('/api', protectedApi);

// --- Error handler ---
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log.error('Unhandled API error', { error: error instanceof Error ? error.message : String(error) });

  if (res.headersSent) {
    return;
  }

  res.status(500).json({
    error:
      config.server.isProduction
        ? 'Internal server error.'
        : error instanceof Error
          ? error.message
          : 'Internal server error.',
  });
});

// --- Start ---
async function startServer() {
  await initDb();

  if (!config.server.isProduction) {
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
    log.info('Server running', { url: `http://localhost:${PORT}` });
  });
}

startServer().catch((error) => {
  log.error('Failed to start server', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
