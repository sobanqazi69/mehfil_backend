const crypto = require('crypto');
const prisma = require('../config/database');
const redis = require('../config/redis');
const logger = require('../utils/logger');
const { signAdmin } = require('../middleware/admin.middleware');

const PAGE_SIZE = 25;

// Length-independent constant-time compare.
const safeEqual = (a, b) => {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const expectedEmail = process.env.ADMIN_EMAIL;
    const expectedPassword = process.env.ADMIN_PASSWORD;

    if (!expectedEmail || !expectedPassword) {
      return res.status(503).json({ message: 'Admin access is not configured' });
    }

    const ok =
      safeEqual(String(email || '').toLowerCase(), expectedEmail.toLowerCase()) &&
      safeEqual(password, expectedPassword);

    if (!ok) {
      logger.warn('admin login rejected', { email });
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    return res.json({
      token: signAdmin({ email: expectedEmail }),
      email: expectedEmail,
    });
  } catch (err) {
    logger.error('admin login failed', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

const stats = async (_req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      newUsersToday,
      newUsersWeek,
      totalRooms,
      liveRooms,
      publicRooms,
      totalMessages,
      messagesToday,
      activeListeners,
      totalBans,
    ] = await prisma.$transaction([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: startOfToday } } }),
      prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.room.count(),
      prisma.room.count({ where: { isLive: true } }),
      prisma.room.count({ where: { isPublic: true } }),
      prisma.message.count(),
      prisma.message.count({ where: { createdAt: { gte: startOfToday } } }),
      prisma.roomMember.count(),
      prisma.roomBan.count(),
    ]);

    // New signups per day for the last 7 days, for the dashboard chart.
    const signupRows = await prisma.$queryRawUnsafe(
      `SELECT DATE(created_at) AS day, COUNT(*) AS count
       FROM users
       WHERE created_at >= ?
       GROUP BY DATE(created_at)
       ORDER BY day ASC`,
      weekAgo,
    );

    const signupsByDay = signupRows.map((r) => ({
      day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
      count: Number(r.count),
    }));

    return res.json({
      users: { total: totalUsers, today: newUsersToday, week: newUsersWeek },
      rooms: { total: totalRooms, live: liveRooms, public: publicRooms },
      messages: { total: totalMessages, today: messagesToday },
      activeListeners,
      bans: totalBans,
      signupsByDay,
    });
  } catch (err) {
    logger.error('admin stats failed', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

const listUsers = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const search = String(req.query.search || '').trim();

    const where = search
      ? {
          OR: [
            { name: { contains: search } },
            { email: { contains: search } },
            { username: { contains: search } },
          ],
        }
      : {};

    const [users, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          avatar: true,
          bio: true,
          createdAt: true,
          _count: { select: { hostedRooms: true, messages: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.user.count({ where }),
    ]);

    return res.json({
      users,
      total,
      page,
      pages: Math.ceil(total / PAGE_SIZE),
    });
  } catch (err) {
    logger.error('admin listUsers failed', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

const listRooms = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const search = String(req.query.search || '').trim();
    const onlyLive = req.query.live === 'true';

    const where = {
      ...(onlyLive ? { isLive: true } : {}),
      ...(search ? { name: { contains: search } } : {}),
    };

    const [rooms, total] = await prisma.$transaction([
      prisma.room.findMany({
        where,
        include: {
          host: { select: { id: true, name: true, avatar: true } },
          _count: { select: { members: true, messages: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.room.count({ where }),
    ]);

    return res.json({
      rooms,
      total,
      page,
      pages: Math.ceil(total / PAGE_SIZE),
    });
  } catch (err) {
    logger.error('admin listRooms failed', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

const recentMessages = async (req, res) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const messages = await prisma.message.findMany({
      include: {
        user: { select: { id: true, name: true, avatar: true } },
        room: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return res.json({ messages });
  } catch (err) {
    logger.error('admin recentMessages failed', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

const deleteRoom = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const room = await prisma.room.findUnique({ where: { id } });
    if (!room) return res.status(404).json({ message: 'Room not found' });

    // Cascades to members, messages and bans via the schema.
    await prisma.room.delete({ where: { id } });
    await redis.del(`room:${id}:state`);
    await redis.del(`room:${id}:members`);

    logger.warn('admin deleted room', { id, by: req.admin?.email });
    return res.json({ ok: true });
  } catch (err) {
    logger.error('admin deleteRoom failed', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

const deleteUser = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Rooms they host must go first — Room.host has no cascade on the user.
    await prisma.$transaction([
      prisma.room.deleteMany({ where: { hostId: id } }),
      prisma.message.deleteMany({ where: { userId: id } }),
      prisma.roomMember.deleteMany({ where: { userId: id } }),
      prisma.roomBan.deleteMany({ where: { userId: id } }),
      prisma.user.delete({ where: { id } }),
    ]);

    logger.warn('admin deleted user', { id, by: req.admin?.email });
    return res.json({ ok: true });
  } catch (err) {
    logger.error('admin deleteUser failed', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  login,
  stats,
  listUsers,
  listRooms,
  recentMessages,
  deleteRoom,
  deleteUser,
};
