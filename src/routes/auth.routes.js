const { Router } = require('express');
const { z } = require('zod');
const { googleAuth, refreshToken } = require('../controllers/auth.controller');
const { validate } = require('../middleware/validate.middleware');
const rateLimit = require('express-rate-limit');

const router = Router();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

router.post('/google', authLimiter, validate(z.object({ idToken: z.string().min(1) })), googleAuth);
router.post('/refresh', validate(z.object({ refreshToken: z.string().min(1) })), refreshToken);

module.exports = router;
