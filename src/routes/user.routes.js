const path = require('path');
const fs = require('fs');
const { Router } = require('express');
const multer = require('multer');
const { z } = require('zod');
const {
  getMe,
  updateMe,
  checkUsername,
  uploadAvatar,
} = require('../controllers/user.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');

const router = Router();

const AVATAR_DIR = path.join(__dirname, '../../uploads/avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, AVATAR_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `u${req.user.id}_${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Only JPG, PNG or WebP images are allowed'), ok);
  },
});

router.use(authenticate);

router.get('/me', getMe);
router.get('/username-available', checkUsername);

router.patch(
  '/me',
  validate(
    z.object({
      name: z.string().min(1).max(100).optional(),
      avatar: z.string().url().optional(),
      username: z
        .string()
        .regex(/^[a-zA-Z0-9_]{3,30}$/, {
          message: '3-30 characters. Letters, numbers and _ only.',
        })
        .optional()
        .nullable(),
    }),
  ),
  updateMe,
);

router.post(
  '/me/avatar',
  (req, res, next) =>
    upload.single('avatar')(req, res, (err) =>
      err ? res.status(400).json({ message: err.message }) : next(),
    ),
  uploadAvatar,
);

module.exports = router;
