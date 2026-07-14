const path = require('path');
const fs = require('fs');
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
    const { name, avatar, username, bio } = req.body;

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(name && { name }),
        ...(avatar && { avatar }),
        ...(username !== undefined && {
          username: username ? username.toLowerCase() : null,
        }),
        ...(bio !== undefined && { bio: bio || null }),
      },
    });
    return res.json(user);
  } catch (err) {
    // Unique constraint: the handle is taken.
    if (err.code === 'P2002') {
      return res.status(409).json({ message: 'That username is already taken' });
    }
    logger.error('updateMe failed', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Cheap availability check so the UI can validate before submit.
const checkUsername = async (req, res) => {
  try {
    const username = String(req.query.username || '').toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(username)) {
      return res.status(400).json({
        available: false,
        message: '3-30 characters. Letters, numbers and _ only.',
      });
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    const available = !existing || existing.id === req.user.id;
    return res.json({ available });
  } catch (err) {
    logger.error('checkUsername failed', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

const uploadAvatar = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No image uploaded' });

    const url = `${process.env.PUBLIC_URL || ''}/uploads/avatars/${req.file.filename}`;

    const previous = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { avatar: true },
    });

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { avatar: url },
    });

    // Bin the old file only if we hosted it — Google-hosted avatars are left be.
    if (previous?.avatar?.includes('/uploads/avatars/')) {
      const old = path.join(
        __dirname,
        '../../uploads/avatars',
        path.basename(previous.avatar),
      );
      fs.unlink(old, () => {});
    }

    return res.json(user);
  } catch (err) {
    logger.error('uploadAvatar failed', err);
    return res.status(500).json({ message: 'Failed to upload image' });
  }
};

module.exports = { getMe, updateMe, checkUsername, uploadAvatar };
