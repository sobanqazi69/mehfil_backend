require('dotenv').config();
const http = require('http');
const app = require('./app');
const { initSocket } = require('./sockets');
const { reconcileStaleRooms } = require('./sockets/room.socket');
const prisma = require('./config/database');
const redis = require('./config/redis');

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
initSocket(server);

const start = async () => {
  try {
    await prisma.$connect();
    console.log('[DB] Prisma connected');

    await redis.connect();

    await reconcileStaleRooms();

    server.listen(PORT, () => {
      console.log(`[Server] Running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
    });
  } catch (err) {
    console.error('[Server] Failed to start:', err.message);
    process.exit(1);
  }
};

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  redis.disconnect();
  server.close(() => process.exit(0));
});

start();
