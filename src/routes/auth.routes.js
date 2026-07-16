const { Router } = require('express');
const { z } = require('zod');
const {
  googleAuth,
  reviewLogin,
  refreshToken,
} = require('../controllers/auth.controller');
const { validate } = require('../middleware/validate.middleware');
const rateLimit = require('express-rate-limit');

const router = Router();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

router.post('/google', authLimiter, validate(z.object({ idToken: z.string().min(1) })), googleAuth);
// Store-reviewer only. Rate-limited like /google so it can't be brute forced.
router.post(
  '/review-login',
  authLimiter,
  validate(
    z.object({
      email: z.string().min(1),
      password: z.string().min(1),
    }),
  ),
  reviewLogin,
);

router.post('/refresh', validate(z.object({ refreshToken: z.string().min(1) })), refreshToken);

module.exports = router;
