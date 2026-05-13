const { OAuth2Client } = require('google-auth-library');
const prisma = require('../config/database');
const { signAccess, signRefresh, verifyRefresh } = require('../utils/jwt.utils');
const logger = require('../utils/logger');


const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const googleAuth = async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: 'idToken is required' });

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const { sub: googleId, name, email, picture: avatar } = ticket.getPayload();

    const user = await prisma.user.upsert({
      where: { googleId },
      update: { name, avatar },
      create: { googleId, name, email, avatar },
    });

    const payload = { id: user.id, email: user.email };
    const accessToken = signAccess(payload);
    const refreshToken = signRefresh(payload);

    return res.json({ accessToken, refreshToken, user });
  } catch (err) {
    logger.error('Google auth failed', err);
    return res.status(401).json({ message: 'Invalid Google token' });
  }
};

const refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;
    if (!token) return res.status(400).json({ message: 'refreshToken is required' });

    const payload = verifyRefresh(token);
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user) return res.status(401).json({ message: 'User not found' });

    const accessToken = signAccess({ id: user.id, email: user.email });
    return res.json({ accessToken });
  } catch (err) {
    logger.error('Token refresh failed', err);
    return res.status(401).json({ message: 'Invalid or expired refresh token' });
  }
};

module.exports = { googleAuth, refreshToken };
