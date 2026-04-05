import 'dotenv/config';

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { initDb } from './db.js';
import type { AuthUser } from './lib/auth.js';
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
const PORT = Number(process.env.PORT || 3000);

const configuredTrustProxy = process.env.TRUST_PROXY?.trim();
const trustProxy =
  configuredTrustProxy === undefined || configuredTrustProxy === ''
    ? 1
    : ['true', 'yes', 'on'].includes(configuredTrustProxy.toLowerCase())
      ? true
      : ['false', 'no', 'off'].includes(configuredTrustProxy.toLowerCase())
        ? false
        : Number.isFinite(Number(configuredTrustProxy))
          ? Number(configuredTrustProxy)
          : configuredTrustProxy;

const allowRegistration = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.ALLOW_REGISTRATION || '').trim().toLowerCase(),
);

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : undefined;

app.set('trust proxy', trustProxy);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors(
    allowedOrigins
      ? { origin: allowedOrigins, credentials: true }
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
      allowRegistration,
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
app.use('/api', protectedApi);

// --- Error handler ---
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled API error:', error);

  if (res.headersSent) {
    return;
  }

  res.status(500).json({
    error:
      process.env.NODE_ENV === 'production'
        ? 'Internal server error.'
        : error instanceof Error
          ? error.message
          : 'Internal server error.',
  });
});

// --- Start ---
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
