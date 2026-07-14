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

      // Original host regains control on re-join
      if (room.creatorId === userId && room.hostId !== userId) {
        await prisma.room.update({ where: { id: roomId }, data: { hostId: userId } });
        logger.socket('host:restored', { roomId, userId });
      }

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

      const state = { youtubeId, timestampSec: 0, isPlaying: false };
      await redis.set(ROOM_STATE_KEY(roomId), JSON.stringify(state));
      await prisma.room.update({ where: { id: roomId }, data: { youtubeId, timestampSec: 0, isPlaying: false } });

      io.to(`room:${roomId}`).emit('video:state', state);
      logger.socket('video:load', { roomId, youtubeId });
    } catch (err) {
      logger.error('video:load error', err);
    }
  });

  socket.on('video:queue', async ({ roomId, nextYoutubeId }) => {
    try {
      roomId = parseInt(roomId);
      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room || room.hostId !== userId) return;

      const state = { youtubeId: room.youtubeId, nextYoutubeId, timestampSec: room.timestampSec, isPlaying: room.isPlaying };
      await redis.set(ROOM_STATE_KEY(roomId), JSON.stringify(state));
      await prisma.room.update({ where: { id: roomId }, data: { nextYoutubeId } });

      io.to(`room:${roomId}`).emit('video:state', state);
      logger.socket('video:queue', { roomId, nextYoutubeId });
    } catch (err) {
      logger.error('video:queue error', err);
    }
  });

  socket.on('video:sync', async ({ roomId, timestamp, isPlaying }) => {
    try {
      roomId = parseInt(roomId);
      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room || room.hostId !== userId) return;

      const existing = await redis.get(ROOM_STATE_KEY(roomId));
      const current = existing ? JSON.parse(existing) : {};
      const state = { ...current, timestampSec: timestamp, isPlaying, updatedAt: Date.now() };

      await redis.set(ROOM_STATE_KEY(roomId), JSON.stringify(state));
      socket.broadcast.to(`room:${roomId}`).emit('video:state', state);
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

  socket.on('room:update_settings', async ({ roomId, isPublic }) => {
    try {
      roomId = parseInt(roomId);
      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room || room.hostId !== userId) return;

      await prisma.room.update({ where: { id: roomId }, data: { isPublic } });
      io.to(`room:${roomId}`).emit('room:settings_updated', { isPublic });
      logger.socket('room:update_settings', { roomId, isPublic });
    } catch (err) {
      logger.error('room:update_settings error', err);
    }
  });

  // 'disconnecting', not 'disconnect' — socket.io clears socket.rooms before
  // 'disconnect' fires, so cleanup there would find nothing to leave.
  socket.on('disconnecting', async () => {
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
  try {
    await prisma.roomMember.deleteMany({ where: { roomId, userId } });
    await redis.srem(ROOM_MEMBERS_KEY(roomId), String(userId));

    const remainingMembers = await prisma.roomMember.findMany({
      where: { roomId },
      orderBy: { joinedAt: 'asc' },
    });

    if (remainingMembers.length === 0) {
      // Auto-delete room when empty
      await prisma.room.delete({ where: { id: roomId } });
      await redis.del(ROOM_STATE_KEY(roomId));
      await redis.del(ROOM_MEMBERS_KEY(roomId));
      logger.socket('room:deleted', { roomId });
    } else {
      // If host left, transfer host status
      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (room && room.hostId === userId) {
        const nextHost = remainingMembers[0].userId;
        await prisma.room.update({ where: { id: roomId }, data: { hostId: nextHost } });
        logger.socket('host:transferred', { roomId, from: userId, to: nextHost });
      }
      await broadcastMembers(io, roomId);
    }
  } catch (err) {
    logger.error('handleLeave error', err);
  }
};

const broadcastMembers = async (io, roomId) => {
  const members = await prisma.roomMember.findMany({
    where: { roomId },
    include: { user: { select: { id: true, name: true, avatar: true } } },
  });
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  io.to(`room:${roomId}`).emit('room:members', {
    hostId: room?.hostId,
    members: members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      avatar: m.user.avatar,
      isMuted: m.isMuted,
    })),
  });
};

/**
 * Runs once at boot. A crash or restart kills every socket without firing
 * 'disconnecting', so any membership row that survived a restart belongs to a
 * client that is no longer connected. Clear them, then drop the rooms they left
 * empty — the same rule handleLeave applies at runtime.
 */
const reconcileStaleRooms = async () => {
  try {
    const { count: staleMembers } = await prisma.roomMember.deleteMany({});

    const emptyRooms = await prisma.room.findMany({
      where: { members: { none: {} } },
      select: { id: true },
    });
    if (emptyRooms.length) {
      const ids = emptyRooms.map((r) => r.id);
      await prisma.room.deleteMany({ where: { id: { in: ids } } });
      for (const id of ids) {
        await redis.del(ROOM_STATE_KEY(id));
        await redis.del(ROOM_MEMBERS_KEY(id));
      }
    }

    logger.socket('rooms:reconciled', {
      staleMembers,
      roomsDeleted: emptyRooms.length,
    });
  } catch (err) {
    logger.error('reconcileStaleRooms error', err);
  }
};

module.exports = { registerRoomEvents, reconcileStaleRooms };
