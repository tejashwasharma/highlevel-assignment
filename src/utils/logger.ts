type LogMeta = Record<string, unknown>;

function log(write: (line: string) => void, level: string, message: string, meta?: LogMeta): void {
  write(JSON.stringify({ level, message, timestamp: new Date().toISOString(), ...meta }));
}

export const logger = {
  info: (msg: string, meta?: LogMeta) => log(console.log, 'info', msg, meta),
  warn: (msg: string, meta?: LogMeta) => log(console.warn, 'warn', msg, meta),
  error: (msg: string, meta?: LogMeta) => log(console.error, 'error', msg, meta),
};
