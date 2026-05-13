const { Router } = require('express');
const { z } = require('zod');
const { getMe, updateMe } = require('../controllers/user.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');

const router = Router();

router.use(authenticate);

router.get('/me', getMe);
router.patch(
  '/me',
  validate(
    z.object({
      name: z.string().min(1).max(100).optional(),
      avatar: z.string().url().optional(),
    }),
  ),
  updateMe,
);

module.exports = router;
