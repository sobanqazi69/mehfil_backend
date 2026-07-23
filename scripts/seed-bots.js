/**
 * Seeds labelled bot accounts and auto-playing bot rooms.
 *
 * Idempotent: re-running updates existing bot rooms/playlists rather than
 * duplicating them. Only ever touches rows flagged isBot / isBotRoom, so real
 * user data is never modified.
 *
 *   node scripts/seed-bots.js
 */
require('dotenv').config({ quiet: true });
const prisma = require('../src/config/database');

const BOT_NAMES = [
  'Ayaan', 'Zara', 'Hamza', 'Iqra', 'Bilal', 'Noor', 'Usman', 'Sana',
  'Faisal', 'Mahnoor', 'Danish', 'Areeba', 'Talha', 'Hira', 'Saad',
  'Fatima', 'Omar', 'Laiba', 'Rehan', 'Amna', 'Shahzad', 'Nimra',
  'Kashif', 'Eman', 'Junaid',
];

// Each entry becomes one room with its own rotating playlist.
// durations are rough runtimes in seconds; the rotator uses them as the
// "now playing" window.
const CHANNELS = [
  { name: '🎧 Lofi & Chill',        videos: [['jfKfPfyJRdk', 'lofi hip hop radio', 600], ['4xDzrJKXOOY', 'synthwave radio', 600], ['S_MOd40zlYU', 'dark ambient', 600]] },
  { name: '🔥 Bollywood Hits',      videos: [['ELIWc7Wnczo', 'Bollywood Mashup', 300], ['pElk1ShPrcE', 'Party Anthems', 280], ['0eSK5UNwHhY', 'Dance Hits', 300]] },
  { name: '🎸 Coke Studio Pakistan', videos: [['Ic2p-yRnbLM', 'Pasoori', 260], ['pnjjcS9wIkU', 'Tu Jhoom', 300], ['ARLcbdKzKTk', 'Kana Yaari', 240]] },
  { name: '🕌 Naat & Qawwali',      videos: [['0ehXEZfd3sk', 'Qawwali Night', 400], ['jZDgAF7gPqE', 'Sufi Classics', 380], ['gEcdEHXWyGk', 'Spiritual Vibes', 360]] },
  { name: '⚡ Gaming Beats',         videos: [['bpJj_S_Cbcw', 'Gaming Mix', 320], ['dQw4w9WgXcQ', 'Classic Energy', 213], ['5qap5aO4i9A', 'Focus Beats', 600]] },
  { name: '🌙 Late Night Urdu',     videos: [['pElk1ShPrcE', 'Night Drive', 280], ['ELIWc7Wnczo', 'Slow Jams', 300], ['jfKfPfyJRdk', 'Midnight Lofi', 600]] },
  { name: '🎬 Movie Trailers',      videos: [['d9MyW72ELq0', 'Trailer Mix', 180], ['TcMBFSGVi1c', 'Action Reel', 170], ['6ZfuNTqbHE8', 'Blockbusters', 190]] },
  { name: '💪 Workout Energy',      videos: [['bpJj_S_Cbcw', 'Gym Mix', 320], ['4xDzrJKXOOY', 'Pump Up', 600], ['pElk1ShPrcE', 'Cardio Beats', 280]] },
  { name: '📚 Study With Me',       videos: [['5qap5aO4i9A', 'Study Beats', 600], ['jfKfPfyJRdk', 'Deep Focus', 600], ['S_MOd40zlYU', 'Ambient Study', 600]] },
  { name: '🎤 Punjabi Bangers',     videos: [['0eSK5UNwHhY', 'Punjabi Mix', 300], ['ELIWc7Wnczo', 'Bhangra Beats', 300], ['pnjjcS9wIkU', 'Desi Vibes', 300]] },
  { name: '🌊 Ambient Ocean',       videos: [['S_MOd40zlYU', 'Ocean Sounds', 600], ['jfKfPfyJRdk', 'Calm Waves', 600], ['5qap5aO4i9A', 'Deep Blue', 600]] },
  { name: '🎹 Piano Lounge',        videos: [['5qap5aO4i9A', 'Piano Bar', 600], ['S_MOd40zlYU', 'Soft Keys', 600], ['jfKfPfyJRdk', 'Evening Piano', 600]] },
  { name: '🚗 Drive Mode',          videos: [['4xDzrJKXOOY', 'Night Drive', 600], ['pElk1ShPrcE', 'Highway Mix', 280], ['0eSK5UNwHhY', 'Road Trip', 300]] },
  { name: '☕ Morning Coffee',      videos: [['jfKfPfyJRdk', 'Morning Lofi', 600], ['5qap5aO4i9A', 'Sunrise Jazz', 600], ['S_MOd40zlYU', 'Slow Start', 600]] },
  { name: '🕺 Retro 90s',           videos: [['dQw4w9WgXcQ', '90s Classics', 213], ['ELIWc7Wnczo', 'Retro Mix', 300], ['pElk1ShPrcE', 'Throwback', 280]] },
  { name: '🎺 Jazz Corner',         videos: [['5qap5aO4i9A', 'Smooth Jazz', 600], ['jfKfPfyJRdk', 'Late Jazz', 600], ['S_MOd40zlYU', 'Blue Note', 600]] },
  { name: '🌸 K-Pop Zone',          videos: [['pElk1ShPrcE', 'K-Pop Hits', 280], ['0eSK5UNwHhY', 'Idol Mix', 300], ['ELIWc7Wnczo', 'Dance Practice', 300]] },
  { name: '🛕 Ghazal Evenings',     videos: [['jZDgAF7gPqE', 'Ghazal Classics', 380], ['0ehXEZfd3sk', 'Urdu Poetry', 400], ['gEcdEHXWyGk', 'Soulful', 360]] },
  { name: '🎮 Esports Highlights',  videos: [['bpJj_S_Cbcw', 'Highlight Reel', 320], ['d9MyW72ELq0', 'Best Plays', 180], ['TcMBFSGVi1c', 'Clutch Moments', 170]] },
  { name: '✨ Trending Now',        videos: [['ELIWc7Wnczo', 'Trending Mix', 300], ['pnjjcS9wIkU', 'Viral Hits', 300], ['0eSK5UNwHhY', 'Top Charts', 300]] },
];

const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

async function main() {
  console.log('Seeding bots…');

  // 1. Bot accounts.
  const bots = [];
  for (const name of BOT_NAMES) {
    const handle = name.toLowerCase();
    const bot = await prisma.user.upsert({
      where: { googleId: `bot_${handle}` },
      update: { isBot: true },
      create: {
        googleId: `bot_${handle}`,
        name,
        username: `${handle}_bot`,
        email: `${handle}.bot@mehfil.local`,
        avatar: `https://api.dicebear.com/7.x/avataaars/png?seed=${handle}`,
        bio: 'Mehfil channel bot 🤖',
        isBot: true,
      },
    });
    bots.push(bot);
  }
  console.log(`  ${bots.length} bot accounts ready`);

  // 2. Rooms — one per channel, hosted by a bot.
  let roomCount = 0;
  for (let i = 0; i < CHANNELS.length; i++) {
    const channel = CHANNELS[i];
    const host = bots[i % bots.length];

    let room = await prisma.room.findFirst({
      where: { name: channel.name, isBotRoom: true },
    });

    if (!room) {
      room = await prisma.room.create({
        data: {
          name: channel.name,
          hostId: host.id,
          creatorId: host.id,
          isPublic: true,
          isLive: true,
          isBotRoom: true,
          youtubeId: channel.videos[0][0],
          isPlaying: true,
        },
      });
    } else {
      await prisma.room.update({
        where: { id: room.id },
        data: { isLive: true, isPublic: true, hostId: host.id },
      });
    }

    // 3. Playlist — rebuilt each run so edits above take effect.
    await prisma.botPlaylistItem.deleteMany({ where: { roomId: room.id } });
    await prisma.botPlaylistItem.createMany({
      data: channel.videos.map(([youtubeId, title, duration], pos) => ({
        roomId: room.id,
        youtubeId,
        title,
        duration,
        position: pos,
      })),
    });

    // 4. Bot listeners: 10–20 per room, host always included.
    const target = rand(10, 20);
    const chosen = shuffle(bots.filter((b) => b.id !== host.id)).slice(
      0,
      Math.max(0, target - 1),
    );
    const memberIds = [host.id, ...chosen.map((b) => b.id)];

    // Clear only bot memberships; never disturb real listeners.
    await prisma.roomMember.deleteMany({
      where: { roomId: room.id, user: { isBot: true } },
    });
    await prisma.roomMember.createMany({
      data: memberIds.map((userId) => ({
        roomId: room.id,
        userId,
        isMuted: true,
      })),
      skipDuplicates: true,
    });

    roomCount++;
    console.log(`  ${channel.name} — ${memberIds.length} bots`);
  }

  console.log(`\nDone: ${roomCount} bot rooms seeded.`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
