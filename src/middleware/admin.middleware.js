const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

// Admin tokens are signed with their own secret so a leaked user token can
// never be replayed against the admin API, and vice versa.
const adminSecret = () =>
  process.env.ADMIN_JWT_SECRET || `${process.env.JWT_SECRET}_admin`;

const signAdmin = (payload) =>
  jwt.sign({ ...payload, scope: 'admin' }, adminSecret(), { expiresIn: '8h' });

const requireAdmin = (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const payload = jwt.verify(header.split(' ')[1], adminSecret());
    if (payload.scope !== 'admin') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    req.admin = payload;
    next();
  } catch (err) {
    logger.error('Admin auth failed', err);
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

module.exports = { requireAdmin, signAdmin };
