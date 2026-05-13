const { Router } = require('express');
const { z } = require('zod');
const { getVoiceToken } = require('../controllers/voice.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');

const router = Router();

router.use(authenticate);

router.post('/token', validate(z.object({ roomId: z.number().int().positive() })), getVoiceToken);

module.exports = router;
