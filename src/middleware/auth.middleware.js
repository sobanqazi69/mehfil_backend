const { verifyAccess } = require('../utils/jwt.utils');
const logger = require('../utils/logger');

const authenticate = (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const token = header.split(' ')[1];
    const payload = verifyAccess(token);
    req.user = payload;
    next();
  } catch (err) {
    logger.error('Auth middleware failed', err);
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

module.exports = { authenticate };
