import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer } from 'ws';
import config from '../config.js';
import logger from '../shared/logger.js';
import { getSessionCookieName, getSessionUser, readCookie } from '../auth/auth.js';
import { LiveCaptionSession } from './live-caption-session.js';

const log = logger.child('live-captions');

export const LIVE_CAPTIONS_PATH = '/api/live/ws';
/** Largest frame accepted from the browser (100 ms of audio is 3.2 KB). */
const MAX_FRAME_BYTES = 256 * 1024;

/**
 * A browser on another site can open a WebSocket to us; the Origin header is how we tell.
 * Accept same-host origins (also via a reverse proxy's X-Forwarded-Host) and CORS_ORIGIN.
 */
export function isAllowedOrigin(request: Pick<IncomingMessage, 'headers'>) {
  const origin = request.headers.origin;
  if (!origin) return true; // not a browser: there is no ambient cookie to abuse
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const hosts = [request.headers.host, request.headers['x-forwarded-host']]
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  if (hosts.includes(originHost)) return true;
  return Boolean(config.server.corsOrigin?.includes(origin));
}

function reject(socket: Duplex, status: number, reason: string) {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/** Serves live caption sessions on the API server's HTTP upgrade path. */
export function attachLiveCaptionServer(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname !== LIVE_CAPTIONS_PATH) return; // other upgrades (e.g. Vite HMR) are not ours

    void (async () => {
      if (!isAllowedOrigin(request)) {
        reject(socket, 403, 'Forbidden');
        return;
      }
      const session = await getSessionUser(readCookie(request.headers.cookie, getSessionCookieName()));
      if (!session) {
        reject(socket, 401, 'Unauthorized');
        return;
      }
      wss.handleUpgrade(request, socket, head, (client) => {
        new LiveCaptionSession(client, session.user);
      });
    })().catch((error) => {
      log.error('Live caption upgrade failed', { error: error instanceof Error ? error.message : String(error) });
      reject(socket, 500, 'Internal Server Error');
    });
  });

  return wss;
}
