const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const {
  login,
  stats,
  listUsers,
  listRooms,
  recentMessages,
  deleteRoom,
  deleteUser,
  setRoomLive,
  setBotsEnabled,
  botsStatus,
} = require('../controllers/admin.controller');
const { requireAdmin } = require('../middleware/admin.middleware');
const { validate } = require('../middleware/validate.middleware');

const router = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

router.post(
  '/login',
  loginLimiter,
  validate(
    z.object({
      email: z.string().min(1),
      password: z.string().min(1),
    }),
  ),
  login,
);

// Everything below requires a valid admin token.
router.use(requireAdmin);

router.get('/stats', stats);
router.get('/users', listUsers);
router.get('/rooms', listRooms);
router.get('/messages', recentMessages);
router.get('/bots/status', botsStatus);
router.post('/bots/toggle', setBotsEnabled);
router.patch('/rooms/:id/live', setRoomLive);
router.delete('/rooms/:id', deleteRoom);
router.delete('/users/:id', deleteUser);

module.exports = router;
