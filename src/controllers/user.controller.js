const prisma = require('../config/database');
const logger = require('../utils/logger');

const getMe = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ message: 'User not found' });
    return res.json(user);
  } catch (err) {
    logger.error('getMe failed', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

const updateMe = async (req, res) => {
  try {
    const { name, avatar } = req.body;
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { ...(name && { name }), ...(avatar && { avatar }) },
    });
    return res.json(user);
  } catch (err) {
    logger.error('updateMe failed', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = { getMe, updateMe };
