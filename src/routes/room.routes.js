const { Router } = require('express');
const { z } = require('zod');
const {
  browseRooms,
  getMyRooms,
  createRoom,
  getRoom,
  deleteRoom,
  getRoomMessages,
} = require('../controllers/room.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');

const router = Router();

router.use(authenticate);

router.get('/', browseRooms);
router.get('/my', getMyRooms);
router.post(
  '/',
  validate(
    z.object({
      name: z.string().min(1).max(150),
      youtubeId: z.string().max(50).optional(),
    }),
  ),
  createRoom,
);
router.get('/:id', getRoom);
router.delete('/:id', deleteRoom);
router.get('/:id/messages', getRoomMessages);

module.exports = router;
