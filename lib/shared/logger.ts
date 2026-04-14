/**
 * Lightweight structured logger.
 *
 * - Production: JSON lines (machine-parseable)
 * - Development: human-readable colored output
 *
 * No external dependencies. Uses console.* under the hood.
 */

import config from '../config.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const minLevel = LOG_LEVELS[config.server.logLevel] ?? LOG_LEVELS.info;

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= minLevel;
}

function formatDev(level: LogLevel, module: string, msg: string, ctx?: Record<string, unknown>) {
  const ts = new Date().toISOString().slice(11, 23);
  const prefix = `${ts} [${level.toUpperCase().padEnd(5)}] [${module}]`;
  if (ctx && Object.keys(ctx).length > 0) {
    return `${prefix} ${msg} ${JSON.stringify(ctx)}`;
  }
  return `${prefix} ${msg}`;
}

function formatJson(level: LogLevel, module: string, msg: string, ctx?: Record<string, unknown>) {
  return JSON.stringify({
    level,
    ts: new Date().toISOString(),
    module,
    msg,
    ...ctx,
  });
}

const format = config.server.isProduction ? formatJson : formatDev;

function createLogFn(level: LogLevel, module: string) {
  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  return (msg: string, ctx?: Record<string, unknown>) => {
    if (!shouldLog(level)) return;
    consoleFn(format(level, module, msg, ctx));
  };
}

export interface Logger {
  debug: (msg: string, ctx?: Record<string, unknown>) => void;
  info: (msg: string, ctx?: Record<string, unknown>) => void;
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
  error: (msg: string, ctx?: Record<string, unknown>) => void;
  child: (module: string) => Logger;
}

function createLogger(module: string): Logger {
  return {
    debug: createLogFn('debug', module),
    info: createLogFn('info', module),
    warn: createLogFn('warn', module),
    error: createLogFn('error', module),
    child: (childModule: string) => createLogger(`${module}:${childModule}`),
  };
}

export const logger = createLogger('app');
export default logger;
