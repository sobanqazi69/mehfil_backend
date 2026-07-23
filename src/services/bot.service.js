const prisma = require('../config/database');
const redis = require('../config/redis');
const logger = require('../utils/logger');

const ROOM_STATE_KEY = (roomId) => `room:${roomId}:state`;

// How often we check whether any bot room is due for its next video.
const TICK_MS = 15_000;

// Greetings are deliberately simple and few — these are labelled bots, not
// pretend humans, so they should feel like a friendly channel, not a person.
const GREETINGS = [
  'hey {name} 👋',
  'welcome, {name}!',
  'yo {name}, good to see you',
  'hi {name} — enjoy the vibe 🎧',
  '{name} just pulled up 🔥',
];

const SMALL_TALK = [
  'this track goes hard',
  'turn it up 🔊',
  'anyone got requests?',
  'vibes are immaculate rn',
  'this is my favourite one',
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const jitter = (min, max) => min + Math.floor(Math.random() * (max - min));

let io = null;
let timer = null;

// roomId -> unix ms when the current video should end.
const nextChangeAt = new Map();

/** Advance a bot room to the next video in its playlist and broadcast it. */
const rotateVideo = async (roomId) => {
  try {
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room || !room.isBotRoom) {
      nextChangeAt.delete(roomId);
      return;
    }

    const playlist = await prisma.botPlaylistItem.findMany({
      where: { roomId },
      orderBy: { position: 'asc' },
    });
    if (playlist.length === 0) return;

    const currentIdx = playlist.findIndex((p) => p.youtubeId === room.youtubeId);
    const next = playlist[(currentIdx + 1) % playlist.length];

    const state = {
      youtubeId: next.youtubeId,
      timestampSec: 0,
      isPlaying: true,
    };

    await prisma.room.update({
      where: { id: roomId },
      data: { youtubeId: next.youtubeId, timestampSec: 0, isPlaying: true },
    });
    await redis.set(ROOM_STATE_KEY(roomId), JSON.stringify(state));

    io?.to(`room:${roomId}`).emit('video:state', state);

    nextChangeAt.set(roomId, Date.now() + next.duration * 1000);
    logger.socket('bot:rotate', { roomId, youtubeId: next.youtubeId });
  } catch (err) {
    logger.error('bot rotateVideo failed', err);
  }
};

/** Post a chat message as one of the room's bots. */
const botSay = async (roomId, text, botUserId = null) => {
  try {
    let userId = botUserId;

    if (!userId) {
      const members = await prisma.roomMember.findMany({
        where: { roomId, user: { isBot: true } },
        select: { userId: true },
      });
      if (members.length === 0) return;
      userId = pick(members).userId;
    }

    const message = await prisma.message.create({
      data: { roomId, userId, text },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    });

    io?.to(`room:${roomId}`).emit('chat:message', {
      id: message.id,
      userId: message.userId,
      name: message.user.name,
      avatar: message.user.avatar,
      text: message.text,
      createdAt: message.createdAt,
      isBot: true,
    });
  } catch (err) {
    logger.error('botSay failed', err);
  }
};

/**
 * A real user joined a bot room — greet them after a short, human-ish pause,
 * then occasionally follow up so the room doesn't feel like a single canned
 * line. Fire-and-forget; never blocks the join.
 */
const onUserJoined = async (roomId, userId) => {
  try {
    const [room, user] = await Promise.all([
      prisma.room.findUnique({ where: { id: roomId } }),
      prisma.user.findUnique({ where: { id: userId } }),
    ]);

    if (!room?.isBotRoom || !user || user.isBot) return;

    const firstName = String(user.name || 'friend').split(' ')[0];

    setTimeout(
      () => botSay(roomId, pick(GREETINGS).replace('{name}', firstName)),
      jitter(1500, 4000),
    );

    // Roughly half the time, a second bot chimes in a bit later.
    if (Math.random() < 0.5) {
      setTimeout(() => botSay(roomId, pick(SMALL_TALK)), jitter(9000, 20000));
    }
  } catch (err) {
    logger.error('bot onUserJoined failed', err);
  }
};

/** Timer loop: rotate any bot room whose current video has run out. */
const tick = async () => {
  try {
    const rooms = await prisma.room.findMany({
      where: { isBotRoom: true },
      select: { id: true },
    });

    const now = Date.now();
    for (const { id } of rooms) {
      const due = nextChangeAt.get(id);
      if (due === undefined) {
        // First time we've seen this room since boot — start its clock.
        await rotateVideo(id);
      } else if (now >= due) {
        await rotateVideo(id);
      }
    }
  } catch (err) {
    logger.error('bot tick failed', err);
  }
};

const start = (ioInstance) => {
  io = ioInstance;
  if (timer) clearInterval(timer);
  timer = setInterval(tick, TICK_MS);
  // Kick once at boot so rooms aren't stuck on a stale video.
  tick();
  logger.info('bot service started');
};

const stop = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = { start, stop, onUserJoined, botSay };
