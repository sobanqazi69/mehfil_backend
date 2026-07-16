const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const prisma = require('../config/database');
const { signAccess, signRefresh, verifyRefresh } = require('../utils/jwt.utils');
const logger = require('../utils/logger');


const googleClient = new OAuth2Client();

// Accept tokens from both web and Android client IDs
const VALID_AUDIENCES = [
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_ANDROID_CLIENT_ID,
].filter(Boolean);

const googleAuth = async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: 'idToken is required' });

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: VALID_AUDIENCES,
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

/**
 * Email+password sign-in for ONE hardcoded account, used only by store
 * reviewers. Google Sign-In is our only real auth path, and Google's own
 * reviewers routinely fail its security challenge on an unfamiliar device —
 * which gets the submission rejected for "cannot access app". This gives them
 * credentials that always work.
 *
 * Deliberately narrow: exactly one account from env, no signup, no password
 * reset, no elevated rights. If REVIEW_EMAIL/REVIEW_PASSWORD are unset the
 * route is disabled entirely.
 */
const reviewLogin = async (req, res) => {
  try {
    const expectedEmail = process.env.REVIEW_EMAIL;
    const expectedPassword = process.env.REVIEW_PASSWORD;

    if (!expectedEmail || !expectedPassword) {
      return res.status(404).json({ message: 'Not found' });
    }

    const { email, password } = req.body;

    // Constant-time compare so the endpoint can't be used as an oracle.
    const emailOk = timingSafeEqualStr(
      String(email || '').toLowerCase(),
      expectedEmail.toLowerCase(),
    );
    const passwordOk = timingSafeEqualStr(
      String(password || ''),
      expectedPassword,
    );

    if (!emailOk || !passwordOk) {
      logger.warn('review login rejected', { email });
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // The reviewer is a normal user row — same permissions as anyone else.
    const user = await prisma.user.upsert({
      where: { email: expectedEmail },
      update: {},
      create: {
        googleId: `review_${Buffer.from(expectedEmail).toString('hex').slice(0, 24)}`,
        name: 'Play Reviewer',
        email: expectedEmail,
      },
    });

    const payload = { id: user.id, email: user.email };
    return res.json({
      accessToken: signAccess(payload),
      refreshToken: signRefresh(payload),
      user,
    });
  } catch (err) {
    logger.error('review login failed', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Length-independent constant-time string compare.
const timingSafeEqualStr = (a, b) => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so length isn't leaked by timing.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
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

module.exports = { googleAuth, reviewLogin, refreshToken };
