export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => console.log(msg, meta ?? ''),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(msg, meta ?? ''),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(msg, meta ?? ''),
};
