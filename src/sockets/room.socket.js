const prisma = require('../config/database');
const redis = require('../config/redis');
const logger = require('../utils/logger');

const ROOM_STATE_KEY = (roomId) => `room:${roomId}:state`;
const ROOM_MEMBERS_KEY = (roomId) => `room:${roomId}:members`;

const registerRoomEvents = (io, socket) => {
  const userId = socket.user.id;

  socket.on('room:join', async ({ roomId }) => {
    try {
      roomId = parseInt(roomId);
      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room) return socket.emit('room:error', { message: 'Room not found' });

      socket.join(`room:${roomId}`);

      await prisma.roomMember.upsert({
        where: { roomId_userId: { roomId, userId } },
        update: { joinedAt: new Date() },
        create: { roomId, userId, isMuted: true },
      });

      await redis.sadd(ROOM_MEMBERS_KEY(roomId), String(userId));

      const videoState = await redis.get(ROOM_STATE_KEY(roomId));
      if (videoState) socket.emit('video:state', JSON.parse(videoState));

      await broadcastMembers(io, roomId);
      logger.socket('room:join', { roomId, userId });
    } catch (err) {
      logger.error('room:join error', err);
      socket.emit('room:error', { message: 'Failed to join room' });
    }
  });

  socket.on('room:leave', async ({ roomId }) => {
    try {
      roomId = parseInt(roomId);
      socket.leave(`room:${roomId}`);
      await handleLeave(io, roomId, userId);
    } catch (err) {
      logger.error('room:leave error', err);
    }
  });

  socket.on('video:load', async ({ roomId, youtubeId }) => {
    try {
      roomId = parseInt(roomId);
      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room || room.hostId !== userId) return;

      const state = { youtubeId, timestamp: 0, isPlaying: false };
      await redis.set(ROOM_STATE_KEY(roomId), JSON.stringify(state));
      await prisma.room.update({ where: { id: roomId }, data: { youtubeId, timestampSec: 0, isPlaying: false } });

      io.to(`room:${roomId}`).emit('video:state', state);
      logger.socket('video:load', { roomId, youtubeId });
    } catch (err) {
      logger.error('video:load error', err);
    }
  });

  socket.on('video:sync', async ({ roomId, timestamp, isPlaying }) => {
    try {
      roomId = parseInt(roomId);
      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room || room.hostId !== userId) return;

      const existing = await redis.get(ROOM_STATE_KEY(roomId));
      const current = existing ? JSON.parse(existing) : {};
      const state = { ...current, timestamp, isPlaying, updatedAt: Date.now() };

      await redis.set(ROOM_STATE_KEY(roomId), JSON.stringify(state));
      io.to(`room:${roomId}`).emit('video:state', state);
    } catch (err) {
      logger.error('video:sync error', err);
    }
  });

  socket.on('chat:send', async ({ roomId, text }) => {
    try {
      roomId = parseInt(roomId);
      if (!text?.trim() || text.length > 500) return;

      const message = await prisma.message.create({
        data: { roomId, userId, text: text.trim() },
        include: { user: { select: { id: true, name: true, avatar: true } } },
      });

      io.to(`room:${roomId}`).emit('chat:message', {
        id: message.id,
        userId: message.userId,
        name: message.user.name,
        avatar: message.user.avatar,
        text: message.text,
        createdAt: message.createdAt,
      });
    } catch (err) {
      logger.error('chat:send error', err);
    }
  });

  socket.on('mic:toggle', async ({ roomId, isMuted }) => {
    try {
      roomId = parseInt(roomId);
      await prisma.roomMember.update({
        where: { roomId_userId: { roomId, userId } },
        data: { isMuted },
      });
      io.to(`room:${roomId}`).emit('mic:state', { userId, isMuted });
    } catch (err) {
      logger.error('mic:toggle error', err);
    }
  });

  socket.on('mic:mute_all', async ({ roomId }) => {
    try {
      roomId = parseInt(roomId);
      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room || room.hostId !== userId) return;

      await prisma.roomMember.updateMany({ where: { roomId }, data: { isMuted: true } });
      io.to(`room:${roomId}`).emit('mic:muted_all');
    } catch (err) {
      logger.error('mic:mute_all error', err);
    }
  });

  socket.on('disconnect', async () => {
    try {
      const rooms = Array.from(socket.rooms).filter((r) => r.startsWith('room:'));
      for (const roomKey of rooms) {
        const roomId = parseInt(roomKey.split(':')[1]);
        await handleLeave(io, roomId, userId);
      }
    } catch (err) {
      logger.error('disconnect cleanup error', err);
    }
  });
};

const handleLeave = async (io, roomId, userId) => {
  await prisma.roomMember.deleteMany({ where: { roomId, userId } });
  await redis.srem(ROOM_MEMBERS_KEY(roomId), String(userId));
  await broadcastMembers(io, roomId);
};

const broadcastMembers = async (io, roomId) => {
  const members = await prisma.roomMember.findMany({
    where: { roomId },
    include: { user: { select: { id: true, name: true, avatar: true } } },
  });
  io.to(`room:${roomId}`).emit('room:members', {
    members: members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      avatar: m.user.avatar,
      isMuted: m.isMuted,
    })),
  });
};

module.exports = { registerRoomEvents };
