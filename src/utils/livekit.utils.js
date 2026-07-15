const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const logger = require('./logger');

// The LiveKit server runs with auto_create=false, so a room must exist before
// anyone can join. RoomServiceClient talks to the server's HTTP API — derive
// the http(s) URL from the ws(s) one in the environment.
const httpUrl = (process.env.LIVEKIT_URL || 'ws://localhost:7880').replace(
  /^ws/,
  'http',
);

let _roomService;
const roomService = () => {
  _roomService ??= new RoomServiceClient(
    httpUrl,
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
  );
  return _roomService;
};

// Room names are namespaced with "mehfil_" to isolate from other apps
// sharing the same LiveKit server (e.g. Bazmi)
const buildLiveKitToken = async (roomId, userId, userName) => {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) throw new Error('LiveKit credentials not configured');

  const roomName = `mehfil_room_${roomId}`;

  // Idempotently ensure the room exists. Creating one that already exists is a
  // no-op on the server; failure here shouldn't block token issuance — the
  // join simply fails downstream if the room truly can't be created.
  try {
    await roomService().createRoom({
      name: roomName,
      // Reap the empty LiveKit room shortly after the last person leaves, so
      // dead rooms don't accumulate on the server.
      emptyTimeout: 60,
      maxParticipants: 50,
    });
  } catch (err) {
    logger.error('LiveKit createRoom failed', err);
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity: String(userId),
    name: userName,
    ttl: '1h',
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
  });

  return { token: await at.toJwt(), roomName };
};

module.exports = { buildLiveKitToken };
