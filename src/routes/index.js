const { Router } = require('express');

const router = Router();

router.use('/auth', require('./auth.routes'));
router.use('/users', require('./user.routes'));
router.use('/rooms', require('./room.routes'));
router.use('/voice', require('./voice.routes'));

module.exports = router;
