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
 * Every credential pair /auth/review-login accepts.
 *
 * REVIEW_EMAIL/REVIEW_PASSWORD is the store-reviewer account. REVIEW_ACCOUNTS
 * holds any additional test logins as a comma-separated "email:password" list,
 * so adding or revoking a tester is an env change, never a code change.
 *
 * Read per request rather than cached at boot so an env edit takes effect on
 * restart without depending on module load order.
 */
const parseReviewAccounts = () => {
  const accounts = [];

  if (process.env.REVIEW_EMAIL && process.env.REVIEW_PASSWORD) {
    accounts.push({
      email: process.env.REVIEW_EMAIL,
      password: process.env.REVIEW_PASSWORD,
      name: 'Play Reviewer',
    });
  }

  for (const entry of String(process.env.REVIEW_ACCOUNTS || '').split(',')) {
    const trimmed = entry.trim();
    // Split on the first colon only — a password may legitimately contain one.
    const sep = trimmed.indexOf(':');
    if (sep <= 0) continue;

    const email = trimmed.slice(0, sep).trim();
    const password = trimmed.slice(sep + 1);
    if (!email || !password) continue;

    accounts.push({ email, password, name: displayNameFor(email) });
  }

  return accounts;
};

/** "soban@gmail.com" → "Soban". Only used when the row is first created. */
const displayNameFor = (email) => {
  const local = String(email).split('@')[0].replace(/[._-]+/g, ' ').trim();
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : 'Tester';
};

/**
 * Email+password sign-in for a small fixed set of test accounts. Google
 * Sign-In is our only real auth path, and Google's own reviewers routinely
 * fail its security challenge on an unfamiliar device — which gets the
 * submission rejected for "cannot access app". This gives them credentials
 * that always work.
 *
 * Deliberately narrow: accounts come from env only, no signup, no password
 * reset, no elevated rights. With none configured the route is disabled.
 */
const reviewLogin = async (req, res) => {
  try {
    const accounts = parseReviewAccounts();
    if (accounts.length === 0) {
      return res.status(404).json({ message: 'Not found' });
    }

    const { email, password } = req.body;
    const givenEmail = String(email || '').toLowerCase();
    const givenPassword = String(password || '');

    // Every account is checked with a constant-time compare, and the loop
    // deliberately does not break early: bailing on the first hit would leak
    // which addresses are configured through response timing.
    let matched = null;
    for (const account of accounts) {
      const emailOk = timingSafeEqualStr(givenEmail, account.email.toLowerCase());
      const passwordOk = timingSafeEqualStr(givenPassword, account.password);
      if (emailOk && passwordOk) matched = account;
    }

    if (!matched) {
      logger.warn('review login rejected', { email });
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // A test login is a normal user row — same permissions as anyone else.
    // Hashed rather than raw hex so two addresses sharing a long prefix can't
    // collide on the unique googleId.
    const user = await prisma.user.upsert({
      where: { email: matched.email },
      update: {},
      create: {
        googleId: `review_${crypto.createHash('sha256').update(matched.email).digest('hex').slice(0, 24)}`,
        name: matched.name,
        email: matched.email,
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
