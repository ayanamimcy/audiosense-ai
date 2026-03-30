import express from 'express';
import {
  authenticateUser,
  changeUserPassword,
  createSession,
  createUser,
  updateUserProfile,
} from '../lib/auth.js';
import {
  asyncRoute,
  authenticateRequest,
  clearSessionCookie,
  requireAuthUser,
  setSessionCookie,
} from './middleware.js';
import {
  getSessionCookieName,
  readCookie,
  destroySession,
} from '../lib/auth.js';

const router = express.Router();

router.post('/register', asyncRoute(async (req, res) => {
  const allowRegistration = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.ALLOW_REGISTRATION || '').trim().toLowerCase(),
  );

  if (!allowRegistration) {
    return res.status(403).json({ error: 'Registration is disabled.' });
  }

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
}));

router.post('/login', asyncRoute(async (req, res) => {
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
}));

router.get('/me', asyncRoute(authenticateRequest), asyncRoute(async (req, res) => {
  return res.json({ user: requireAuthUser(req) });
}));

router.post('/logout', asyncRoute(async (req, res) => {
  const token = readCookie(req.headers.cookie, getSessionCookieName());
  await destroySession(token);
  clearSessionCookie(res);
  return res.json({ success: true });
}));

export const authRouter = router;
