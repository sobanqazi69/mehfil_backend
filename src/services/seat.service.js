const prisma = require('../config/database');
const logger = require('../utils/logger');

/**
 * Mic seats. A room has a fixed set of slots and ONLY a user sitting on one is
 * allowed to speak; everyone else is audience and can still watch and chat.
 *
 * Seat rows are created up-front, so an empty seat is a row with a null userId
 * rather than a missing row. That lets the @@unique([roomId, seatNo]) index do
 * the real work: two people racing for the last seat cannot both win, because
 * the winner is decided by a conditional UPDATE, not by a read-then-write.
 */

/** Create the seat rows for a room. Idempotent. */
const ensureSeats = async (roomId, maxSeats = 5) => {
  try {
    await prisma.roomSeat.createMany({
      data: Array.from({ length: maxSeats }, (_, seatNo) => ({
        roomId,
        seatNo,
        role: seatNo === 0 ? 'HOST' : 'SPEAKER',
      })),
      skipDuplicates: true,
    });
  } catch (err) {
    logger.error('ensureSeats error', err);
  }
};

/** Every seat in the room, ordered, shaped for the client. */
const listSeats = async (roomId) => {
  const seats = await prisma.roomSeat.findMany({
    where: { roomId },
    include: { user: { select: { id: true, name: true, avatar: true } } },
    orderBy: { seatNo: 'asc' },
  });

  return seats.map((s) => ({
    seatNo: s.seatNo,
    userId: s.userId,
    name: s.user?.name ?? null,
    avatar: s.user?.avatar ?? null,
    role: s.role,
    isMuted: s.isMuted,
    isLocked: s.isLocked,
  }));
};

const broadcastSeats = async (io, roomId) => {
  try {
    io.to(`room:${roomId}`).emit('room:seats', { seats: await listSeats(roomId) });
  } catch (err) {
    logger.error('broadcastSeats error', err);
  }
};

/** Is this user currently on a seat and un-muted? The authority on speaking. */
const canSpeak = async (roomId, userId) => {
  try {
    const seat = await prisma.roomSeat.findFirst({ where: { roomId, userId } });
    return Boolean(seat) && !seat.isMuted;
  } catch (err) {
    logger.error('canSpeak error', err);
    return false;
  }
};

/** Free whatever seat a user occupies. Returns true if they were on one. */
const vacate = async (roomId, userId) => {
  try {
    const { count } = await prisma.roomSeat.updateMany({
      where: { roomId, userId },
      data: { userId: null, isMuted: false, occupiedAt: null },
    });
    return count > 0;
  } catch (err) {
    logger.error('seat vacate error', err);
    return false;
  }
};

/**
 * Sit down. Returns `{ ok }` or `{ ok: false, reason }`.
 *
 * The claim is an UPDATE guarded by `userId: null`, so if two clients grab the
 * same seat in the same tick exactly one gets `count === 1`. Checking
 * occupancy with a SELECT first would let both through.
 */
const take = async (roomId, userId, seatNo, { isHost }) => {
  try {
    const seat = await prisma.roomSeat.findUnique({
      where: { roomId_seatNo: { roomId, seatNo } },
    });
    if (!seat) return { ok: false, reason: 'That seat does not exist' };
    if (seat.isLocked) return { ok: false, reason: 'That seat is locked' };
    if (seat.userId === userId) return { ok: true, changed: false };
    if (seat.userId) return { ok: false, reason: 'That seat is taken' };
    if (seat.role === 'HOST' && !isHost) {
      return { ok: false, reason: 'That seat is reserved for the host' };
    }

    // One person, one seat: drop the old one before claiming the new one.
    await vacate(roomId, userId);

    const { count } = await prisma.roomSeat.updateMany({
      where: { roomId, seatNo, userId: null },
      data: { userId, isMuted: false, occupiedAt: new Date() },
    });

    if (count === 0) return { ok: false, reason: 'That seat was just taken' };
    return { ok: true, changed: true };
  } catch (err) {
    logger.error('seat take error', err);
    return { ok: false, reason: 'Could not take that seat' };
  }
};

/**
 * Give the host their seat on join, if it is free. Best-effort: a host who
 * joins to find seat 0 occupied simply stays in the audience until they act.
 */
const seatHost = async (roomId, hostId) => {
  try {
    const existing = await prisma.roomSeat.findFirst({
      where: { roomId, userId: hostId },
    });
    if (existing) return false;

    const { count } = await prisma.roomSeat.updateMany({
      where: { roomId, seatNo: 0, userId: null, isLocked: false },
      data: { userId: hostId, isMuted: false, occupiedAt: new Date() },
    });
    return count > 0;
  } catch (err) {
    logger.error('seatHost error', err);
    return false;
  }
};

/**
 * Keep the HOST role on the seat the host actually occupies, so a transfer
 * does not leave the crown on an empty chair.
 */
const moveHostRole = async (roomId, newHostId) => {
  try {
    const seat = await prisma.roomSeat.findFirst({
      where: { roomId, userId: newHostId },
    });

    await prisma.roomSeat.updateMany({
      where: { roomId, role: 'HOST' },
      data: { role: 'SPEAKER' },
    });

    // The new host is seated: crown that seat. Otherwise fall back to seat 0
    // so the room always has exactly one host seat.
    await prisma.roomSeat.updateMany({
      where: { roomId, seatNo: seat ? seat.seatNo : 0 },
      data: { role: 'HOST' },
    });
  } catch (err) {
    logger.error('moveHostRole error', err);
  }
};

module.exports = {
  ensureSeats,
  listSeats,
  broadcastSeats,
  canSpeak,
  vacate,
  take,
  seatHost,
  moveHostRole,
};
