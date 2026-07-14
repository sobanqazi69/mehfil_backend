const { Server } = require('socket.io');
const { verifyAccess } = require('../utils/jwt.utils');
const { registerRoomEvents } = require('./room.socket');
const logger = require('../utils/logger');

const initSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || '*',
      methods: ['GET', 'POST'],
    },
    // A killed mobile app never closes its socket cleanly, so departure is only
    // detected by ping timeout. Defaults (25s + 20s) leave a ghost in the room
    // for up to 45s; this cuts worst case to ~20s.
    pingInterval: 10000,
    pingTimeout: 10000,
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication required'));
      const payload = verifyAccess(token);
      socket.user = payload;
      // socket.data survives fetchSockets(); socket.user does not.
      socket.data.userId = payload.id;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    logger.socket('connected', { userId: socket.user.id, socketId: socket.id });
    registerRoomEvents(io, socket);
  });

  return io;
};

module.exports = { initSocket };
