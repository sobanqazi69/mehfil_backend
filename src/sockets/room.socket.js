const prisma = require('../config/database');
const redis = require('../config/redis');
const logger = require('../utils/logger');
const botService = require('../services/bot.service');
const seatService = require('../services/seat.service');

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

      // Rooms created before seats existed have none; backfill on first join.
      await seatService.ensureSeats(roomId, room.maxSeats);

      // Whoever holds the room takes the host chair if it is free.
      const currentHostId = room.creatorId === userId ? userId : room.hostId;
      if (currentHostId === userId) await seatService.seatHost(roomId, userId);

      await broadcastMembers(io, roomId);
      await seatService.broadcastSeats(io, roomId);
      logger.socket('room:join', { roomId, userId });

      // Bot rooms welcome real arrivals. Fire-and-forget.
      botService.onUserJoined(roomId, userId);
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

  // ── Seats ────────────────────────────────────────────────────────────────

  socket.on('seat:take', async ({ roomId, seatNo }) => {
    try {
      roomId = parseInt(roomId);
      seatNo = parseInt(seatNo);
      if (Number.isNaN(roomId) || Number.isNaN(seatNo)) return;

      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room) return;

      // Must actually be in the room — never let a non-member claim a mic.
      const member = await prisma.roomMember.findUnique({
        where: { roomId_userId: { roomId, userId } },
      });
      if (!member) return;

      const result = await seatService.take(roomId, userId, seatNo, {
        isHost: room.hostId === userId,
      });

      if (!result.ok) {
        socket.emit('seat:denied', { seatNo, message: result.reason });
        // The client sat down optimistically. Nothing else is being broadcast
        // on this path, so hand this one socket the real seats to snap back to.
        return socket.emit('room:seats', {
          seats: await seatService.listSeats(roomId),
        });
      }

      // Sitting down clears a self-mute; the host lock is untouched, so a
      // host-muted user stays silent even once seated.
      if (result.changed) {
        await prisma.roomMember.update({
          where: { roomId_userId: { roomId, userId } },
          data: { isMuted: false },
        });
        io.to(`room:${roomId}`).emit('mic:state', {
          userId,
          isMuted: false,
          mutedByHost: member.mutedByHost,
        });
      }

      await seatService.broadcastSeats(io, roomId);
      logger.socket('seat:take', { roomId, userId, seatNo });
    } catch (err) {
      logger.error('seat:take error', err);
    }
  });

  socket.on('seat:leave', async ({ roomId }) => {
    try {
      roomId = parseInt(roomId);
      if (Number.isNaN(roomId)) return;

      const wasSeated = await seatService.vacate(roomId, userId);
      if (!wasSeated) return;

      // Leaving the mic silences you: an audience member is never live.
      await prisma.roomMember.updateMany({
        where: { roomId, userId },
        data: { isMuted: true },
      });
      io.to(`room:${roomId}`).emit('mic:state', {
        userId,
        isMuted: true,
        mutedByHost: false,
      });

      await seatService.broadcastSeats(io, roomId);
      logger.socket('seat:leave', { roomId, userId });
    } catch (err) {
      logger.error('seat:leave error', err);
    }
  });

  // Host mutes/unmutes whoever is on a seat, without unseating them.
  socket.on('seat:mute', async ({ roomId, seatNo, isMuted }) => {
    try {
      roomId = parseInt(roomId);
      seatNo = parseInt(seatNo);

      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room || room.hostId !== userId) return;

      const seat = await prisma.roomSeat.findUnique({
        where: { roomId_seatNo: { roomId, seatNo } },
      });
      if (!seat || !seat.userId) return;

      await prisma.roomSeat.update({
        where: { roomId_seatNo: { roomId, seatNo } },
        data: { isMuted: Boolean(isMuted) },
      });

      await seatService.broadcastSeats(io, roomId);
      logger.socket('seat:mute', { roomId, seatNo, isMuted: Boolean(isMuted) });
    } catch (err) {
      logger.error('seat:mute error', err);
    }
  });

  /**
   * A seated user's emoji reaction, rendered over their chair for a moment.
   *
   * Deliberately ephemeral — never written to the messages table. Audience
   * reactions go through chat:send instead, so the client picks the route and
   * the server only has to police "is this person actually on a seat".
   */
  socket.on('reaction:send', async ({ roomId, emoji }) => {
    try {
      roomId = parseInt(roomId);
      if (Number.isNaN(roomId)) return;

      // Cap the length: this is broadcast verbatim, so an unbounded string
      // would be a free megaphone into every client in the room.
      if (typeof emoji !== 'string' || emoji.length === 0 || emoji.length > 16) {
        return;
      }

      const seat = await prisma.roomSeat.findFirst({
        where: { roomId, userId },
      });
      if (!seat) return; // audience reactions belong in chat

      io.to(`room:${roomId}`).emit('reaction:receive', {
        userId,
        seatNo: seat.seatNo,
        emoji,
      });
    } catch (err) {
      logger.error('reaction:send error', err);
    }
  });

  // Host closes/opens a slot. Locking an occupied seat also clears it —
  // a locked seat with someone still speaking on it would be a lie.
  socket.on('seat:lock', async ({ roomId, seatNo, isLocked }) => {
    try {
      roomId = parseInt(roomId);
      seatNo = parseInt(seatNo);

      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room || room.hostId !== userId) return;

      const seat = await prisma.roomSeat.findUnique({
        where: { roomId_seatNo: { roomId, seatNo } },
      });
      if (!seat) return;

      const locked = Boolean(isLocked);

      if (locked && seat.userId) {
        const evictedUserId = seat.userId;
        await seatService.vacate(roomId, evictedUserId);
        await prisma.roomMember.updateMany({
          where: { roomId, userId: evictedUserId },
          data: { isMuted: true },
        });
        io.to(`room:${roomId}`).emit('mic:state', {
          userId: evictedUserId,
          isMuted: true,
          mutedByHost: false,
        });
      }

      await prisma.roomSeat.update({
        where: { roomId_seatNo: { roomId, seatNo } },
        data: { isLocked: locked },
      });

      await seatService.broadcastSeats(io, roomId);
      logger.socket('seat:lock', { roomId, seatNo, locked, by: userId });
    } catch (err) {
      logger.error('seat:lock error', err);
    }
  });

  // Host sends a speaker back to the audience.
  socket.on('seat:remove', async ({ roomId, seatNo }) => {
    try {
      roomId = parseInt(roomId);
      seatNo = parseInt(seatNo);

      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room || room.hostId !== userId) return;

      const seat = await prisma.roomSeat.findUnique({
        where: { roomId_seatNo: { roomId, seatNo } },
      });
      if (!seat || !seat.userId) return;

      const removedUserId = seat.userId;
      await seatService.vacate(roomId, removedUserId);

      await prisma.roomMember.updateMany({
        where: { roomId, userId: removedUserId },
        data: { isMuted: true },
      });
      io.to(`room:${roomId}`).emit('mic:state', {
        userId: removedUserId,
        isMuted: true,
        mutedByHost: false,
      });

      await seatService.broadcastSeats(io, roomId);
      logger.socket('seat:remove', { roomId, seatNo, removedUserId, by: userId });
    } catch (err) {
      logger.error('seat:remove error', err);
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
          reason: 'host',
        });
      }

      // Seats are the authority on who may speak. Unmuting from the audience
      // is refused outright — otherwise the seat system is decoration and a
      // patched client could talk over a full room.
      if (!isMuted) {
        const seat = await prisma.roomSeat.findFirst({
          where: { roomId, userId },
        });
        if (!seat) {
          return socket.emit('mic:blocked', {
            message: 'Take a seat to speak',
            reason: 'seat',
          });
        }
        if (seat.isMuted) {
          return socket.emit('mic:blocked', {
            message: 'The host muted your seat',
            reason: 'seat',
          });
        }
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

  // Host lifts the mute on everyone and hands their mics back.
  socket.on('mic:unmute_all', async ({ roomId }) => {
    try {
      roomId = parseInt(roomId);
      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room || room.hostId !== userId) return;

      // Clear the host lock and open their mics, so "unmute all" actually lets
      // people speak rather than just permitting them to unmute themselves.
      await prisma.roomMember.updateMany({
        where: { roomId, userId: { not: userId } },
        data: { isMuted: false, mutedByHost: false },
      });

      await broadcastMembers(io, roomId);
      logger.socket('mic:unmute_all', { roomId, by: userId });
    } catch (err) {
      logger.error('mic:unmute_all error', err);
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

      // The crown follows the person, not the chair.
      await seatService.moveHostRole(roomId, targetUserId);

      io.to(`room:${roomId}`).emit('room:host_changed', {
        hostId: targetUserId,
      });
      await broadcastMembers(io, roomId);
      await seatService.broadcastSeats(io, roomId);
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
    // Free their chair, or the room slowly fills with ghosts nobody can evict.
    const wasSeated = await seatService.vacate(roomId, userId);
    await redis.srem(ROOM_MEMBERS_KEY(roomId), String(userId));

    const remainingMembers = await prisma.roomMember.findMany({
      where: { roomId },
      orderBy: { joinedAt: 'asc' },
    });

    const room0 = await prisma.room.findUnique({ where: { id: roomId } });

    // Bot rooms are permanent channels — never auto-delete them, and never
    // transfer their host away from the owning bot account.
    if (room0?.isBotRoom) {
      await broadcastMembers(io, roomId);
      if (wasSeated) await seatService.broadcastSeats(io, roomId);
      return;
    }

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
        // Promoted mid-room: give them the host chair and the crown, otherwise
        // the new host has room controls but no mic.
        await seatService.seatHost(roomId, nextHost);
        await seatService.moveHostRole(roomId, nextHost);
        logger.socket('host:transferred', { roomId, from: userId, to: nextHost });
      }
      await broadcastMembers(io, roomId);
      await seatService.broadcastSeats(io, roomId);
    }
  } catch (err) {
    logger.error('handleLeave error', err);
  }
};

const broadcastMembers = async (io, roomId) => {
  const members = await prisma.roomMember.findMany({
    where: { roomId },
    include: {
      user: { select: { id: true, name: true, avatar: true, isBot: true } },
    },
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
      isBot: m.user.isBot,
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
    // Bot rooms are server-run channels: their bot listeners are permanent and
    // must survive restarts, so exclude them from both sweeps.
    const { count: staleMembers } = await prisma.roomMember.deleteMany({
      where: { room: { isBotRoom: false } },
    });

    // Same reasoning for seats: nobody survives a restart still sitting down,
    // and a seat held by a ghost can never be freed by its occupant.
    await prisma.roomSeat.updateMany({
      where: { userId: { not: null }, room: { isBotRoom: false } },
      data: { userId: null, isMuted: false, occupiedAt: null },
    });

    const emptyRooms = await prisma.room.findMany({
      where: { isBotRoom: false, members: { none: {} } },
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
