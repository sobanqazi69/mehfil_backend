const redis = require('../config/redis');
const logger = require('./logger');

const ROOM_STATE_KEY = (roomId) => `room:${roomId}:state`;

/**
 * The room's video position as of RIGHT NOW.
 *
 * Two things make the naive answer wrong:
 *
 *  1. `video:sync` only writes Redis, never the DB — so `rooms.timestamp_sec`
 *     is stale the moment playback starts. Serving it to a joiner starts them
 *     in the wrong place.
 *  2. Even the Redis snapshot ages. A room that last synced 8s ago is 8s
 *     further along now. Advancing by the elapsed time is what stops a joiner
 *     from starting behind and then visibly jumping forward to catch up.
 *
 * Both timestamps come from this process's clock, so the arithmetic is safe —
 * no client clock is involved.
 */
const getLiveVideoState = async (roomId) => {
  try {
    const raw = await redis.get(ROOM_STATE_KEY(roomId));
    if (!raw) return null;

    const state = JSON.parse(raw);
    let timestampSec = Number(state.timestampSec) || 0;

    if (state.isPlaying && state.updatedAt) {
      timestampSec += (Date.now() - Number(state.updatedAt)) / 1000;
    }

    return { ...state, timestampSec };
  } catch (err) {
    logger.error('getLiveVideoState failed', err);
    return null;
  }
};

module.exports = { ROOM_STATE_KEY, getLiveVideoState };
