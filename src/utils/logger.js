const isDev = process.env.NODE_ENV === 'development';

const logger = {
  info: (msg, meta) => isDev && console.log(`[INFO] ${msg}`, meta ?? ''),
  warn: (msg, meta) => console.warn(`[WARN] ${msg}`, meta ?? ''),
  error: (msg, err) => console.error(`[ERROR] ${msg}`, err?.message ?? err ?? ''),
  socket: (event, data) => isDev && console.log(`[SOCKET] ${event}`, data ?? ''),
};

module.exports = logger;
