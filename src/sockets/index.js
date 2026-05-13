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
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication required'));
      const payload = verifyAccess(token);
      socket.user = payload;
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
