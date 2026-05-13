const { buildLiveKitToken } = require('../utils/livekit.utils');
const prisma = require('../config/database');
const logger = require('../utils/logger');

const getVoiceToken = async (req, res) => {
  try {
    const { roomId } = req.body;
    if (!roomId) return res.status(400).json({ message: 'roomId is required' });

    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) return res.status(404).json({ message: 'Room not found' });

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const { token, roomName } = await buildLiveKitToken(roomId, req.user.id, user.name);

    return res.json({
      token,
      roomName,
      livekitUrl: process.env.LIVEKIT_URL,
    });
  } catch (err) {
    logger.error('getVoiceToken failed', err);
    return res.status(500).json({ message: 'Failed to generate voice token' });
  }
};

module.exports = { getVoiceToken };
