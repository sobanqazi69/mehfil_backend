const { AccessToken } = require('livekit-server-sdk');

// Room names are namespaced with "mehfil_" to isolate from other apps
// sharing the same LiveKit server (e.g. Bazmi)
const buildLiveKitToken = async (roomId, userId, userName) => {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) throw new Error('LiveKit credentials not configured');

  const roomName = `mehfil_room_${roomId}`;

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
