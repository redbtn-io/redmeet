import 'server-only';

type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, message: string, fields?: Record<string, unknown>) {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    level,
    service: 'redmeet',
    message,
    ...fields,
  });
  if (level === 'error') console.error(line);
  else console.log(line);
}

/** Minimal structured logger. Canonical redlog wiring lands with F8. */
export const logger = {
  debug: (m: string, f?: Record<string, unknown>) => emit('debug', m, f),
  info: (m: string, f?: Record<string, unknown>) => emit('info', m, f),
  warn: (m: string, f?: Record<string, unknown>) => emit('warn', m, f),
  error: (m: string, f?: Record<string, unknown>) => emit('error', m, f),
};
