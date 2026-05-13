const prisma = require('../config/database');
const logger = require('../utils/logger');

const ROOMS_PER_PAGE = 20;
const MESSAGES_LIMIT = 50;

const browseRooms = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const category = req.query.category;

    const where = { isPublic: true, isLive: true, ...(category && { category }) };

    const [rooms, total] = await prisma.$transaction([
      prisma.room.findMany({
        where,
        include: {
          host: { select: { id: true, name: true, avatar: true } },
          _count: { select: { members: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * ROOMS_PER_PAGE,
        take: ROOMS_PER_PAGE,
      }),
      prisma.room.count({ where }),
    ]);

    return res.json({ rooms, total, page, pages: Math.ceil(total / ROOMS_PER_PAGE) });
  } catch (err) {
    logger.error('browseRooms failed', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

const getMyRooms = async (req, res) => {
  try {
    const rooms = await prisma.room.findMany({
      where: { hostId: req.user.id },
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(rooms);
  } catch (err) {
    logger.error('getMyRooms failed', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

const createRoom = async (req, res) => {
  try {
    const { name, isPublic = true, category } = req.body;
    const room = await prisma.room.create({
      data: { name, isPublic, category, hostId: req.user.id },
      include: { host: { select: { id: true, name: true, avatar: true } } },
    });
    return res.status(201).json(room);
  } catch (err) {
    logger.error('createRoom failed', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

const getRoom = async (req, res) => {
  try {
    const roomId = parseInt(req.params.id);
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        host: { select: { id: true, name: true, avatar: true } },
        members: { include: { user: { select: { id: true, name: true, avatar: true } } } },
        _count: { select: { members: true } },
      },
    });
    if (!room) return res.status(404).json({ message: 'Room not found' });
    return res.json(room);
  } catch (err) {
    logger.error('getRoom failed', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

const deleteRoom = async (req, res) => {
  try {
    const roomId = parseInt(req.params.id);
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (room.hostId !== req.user.id) return res.status(403).json({ message: 'Forbidden' });

    await prisma.room.delete({ where: { id: roomId } });
    return res.json({ message: 'Room deleted' });
  } catch (err) {
    logger.error('deleteRoom failed', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

const getRoomMessages = async (req, res) => {
  try {
    const roomId = parseInt(req.params.id);
    const messages = await prisma.message.findMany({
      where: { roomId },
      include: { user: { select: { id: true, name: true, avatar: true } } },
      orderBy: { createdAt: 'desc' },
      take: MESSAGES_LIMIT,
    });
    return res.json(messages.reverse());
  } catch (err) {
    logger.error('getRoomMessages failed', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = { browseRooms, getMyRooms, createRoom, getRoom, deleteRoom, getRoomMessages };
