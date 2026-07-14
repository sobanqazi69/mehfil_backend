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

      // A kicked user can never come back.
      const ban = await prisma.roomBan.findUnique({
        where: { roomId_userId: { roomId, userId } },
      });
      if (ban) {
        logger.socket('room:join_denied', { roomId, userId });
        return socket.emit('room:kicked', { roomId });
      }

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

  // Self-mute. Refused while the host has you muted — only the host can lift
  // that, otherwise a client could just unmute itself out of a moderation.
  socket.on('mic:toggle', async ({ roomId, isMuted }) => {
    try {
      roomId = parseInt(roomId);

      const member = await prisma.roomMember.findUnique({
        where: { roomId_userId: { roomId, userId } },
      });
      if (!member) return;

      if (member.mutedByHost && !isMuted) {
        return socket.emit('mic:blocked', {
          message: 'The host has muted you',
        });
      }

      await prisma.roomMember.update({
        where: { roomId_userId: { roomId, userId } },
        data: { isMuted },
      });

      io.to(`room:${roomId}`).emit('mic:state', {
        userId,
        isMuted,
        mutedByHost: member.mutedByHost,
      });
    } catch (err) {
      logger.error('mic:toggle error', err);
    }
  });

  socket.on('mic:mute_all', async ({ roomId }) => {
    try {
      roomId = parseInt(roomId);
      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room || room.hostId !== userId) return;

      // Mute-all is a host action, so it sets the host lock too — listeners
      // cannot immediately unmute themselves out of it.
      await prisma.roomMember.updateMany({
        where: { roomId, userId: { not: userId } },
        data: { isMuted: true, mutedByHost: true },
      });
      io.to(`room:${roomId}`).emit('mic:muted_all');
      await broadcastMembers(io, roomId);
    } catch (err) {
      logger.error('mic:mute_all error', err);
    }
  });

  // Host force-mutes / unmutes another listener.
  socket.on('mic:force_toggle', async ({ roomId, targetUserId, isMuted }) => {
    try {
      roomId = parseInt(roomId);
      targetUserId = parseInt(targetUserId);

      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room || room.hostId !== userId) return;
      if (targetUserId === userId) return; // host uses mic:toggle for itself

      const member = await prisma.roomMember.findUnique({
        where: { roomId_userId: { roomId, userId: targetUserId } },
      });
      if (!member) return;

      const mutedByHost = Boolean(isMuted);

      // Host-mute is its own flag. Muting also forces isMuted so the mic is
      // actually off; unmuting only lifts the host lock and hands control back
      // — the member's own isMuted stands.
      await prisma.roomMember.update({
        where: { roomId_userId: { roomId, userId: targetUserId } },
        data: mutedByHost
          ? { mutedByHost: true, isMuted: true }
          : { mutedByHost: false },
      });

      const updated = await prisma.roomMember.findUnique({
        where: { roomId_userId: { roomId, userId: targetUserId } },
      });

      io.to(`room:${roomId}`).emit('mic:state', {
        userId: targetUserId,
        isMuted: updated.isMuted,
        mutedByHost: updated.mutedByHost,
      });
      logger.socket('mic:force_toggle', { roomId, targetUserId, mutedByHost });
    } catch (err) {
      logger.error('mic:force_toggle error', err);
    }
  });

  // Host hands the room to another listener and becomes a normal user.
  socket.on('room:transfer_host', async ({ roomId, targetUserId }) => {
    try {
      roomId = parseInt(roomId);
      targetUserId = parseInt(targetUserId);

      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room || room.hostId !== userId) return;
      if (targetUserId === userId) return;

      const member = await prisma.roomMember.findUnique({
        where: { roomId_userId: { roomId, userId: targetUserId } },
      });
      if (!member) return;

      // creatorId moves too. It is what room:join uses to auto-restore host on
      // rejoin — leaving it behind would let the old host silently steal the
      // room back the next time they reconnect.
      await prisma.room.update({
        where: { id: roomId },
        data: { hostId: targetUserId, creatorId: targetUserId },
      });

      io.to(`room:${roomId}`).emit('room:host_changed', {
        hostId: targetUserId,
      });
      await broadcastMembers(io, roomId);
      logger.socket('room:transfer_host', { roomId, from: userId, to: targetUserId });
    } catch (err) {
      logger.error('room:transfer_host error', err);
    }
  });

  // Host removes a listener from the room.
  socket.on('room:kick', async ({ roomId, targetUserId }) => {
    try {
      roomId = parseInt(roomId);
      targetUserId = parseInt(targetUserId);

      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room || room.hostId !== userId) return;
      if (targetUserId === userId) return; // host cannot kick itself

      const roomKey = `room:${roomId}`;

      // Permanent ban: room:join is refused and the room is hidden from browse.
      await prisma.roomBan.upsert({
        where: { roomId_userId: { roomId, userId: targetUserId } },
        update: {},
        create: { roomId, userId: targetUserId },
      });

      // Tell the kicked user's sockets and take them out of the room, so a
      // rejoin has to go through room:join again.
      const sockets = await io.in(roomKey).fetchSockets();
      for (const s of sockets) {
        if (s.data.userId === targetUserId) {
          s.emit('room:kicked', { roomId });
          s.leave(roomKey);
        }
      }

      // Same cleanup a voluntary leave does: drop membership, transfer host if
      // needed, delete the room when it empties, rebroadcast the roster.
      await handleLeave(io, roomId, targetUserId);
      logger.socket('room:kick', { roomId, targetUserId, by: userId });
    } catch (err) {
      logger.error('room:kick error', err);
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
    orderBy: { joinedAt: 'asc' },
  });
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  io.to(`room:${roomId}`).emit('room:members', {
    hostId: room?.hostId,
    members: members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      avatar: m.user.avatar,
      isMuted: m.isMuted,
      mutedByHost: m.mutedByHost,
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
