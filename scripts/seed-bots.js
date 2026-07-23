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

// Photo-realistic portraits so bot listeners don't look like cartoons. These
// are stock placeholder faces, and every bot is still surfaced with a visible
// BOT badge in the app — they are never passed off as real accounts.
const PORTRAITS = Array.from({ length: 25 }, (_, i) =>
  i % 2 === 0
    ? `https://randomuser.me/api/portraits/men/${20 + i}.jpg`
    : `https://randomuser.me/api/portraits/women/${20 + i}.jpg`,
);

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
  {
    name: "🎧 Lofi & Chill",
    videos: [
      [
        "jfKfPfyJRdk",
        "lofi hip hop radio 📚 beats to relax/study to",
        300
      ],
      [
        "4xDzrJKXOOY",
        "synthwave radio 🌌 beats to chill/game to",
        300
      ],
      [
        "S_MOd40zlYU",
        "dark ambient radio 🌃 music to escape/dream to",
        300
      ]
    ]
  },
  {
    name: "🌌 Synthwave Nights",
    videos: [
      [
        "pElk1ShPrcE",
        "Ainvayi Ainvayi Song | Band Baaja Baaraat | Ranveer Singh, Anushka Sharma |  Sun",
        300
      ],
      [
        "5qap5aO4i9A",
        "lofi hip hop radio - beats to relax/study to",
        300
      ],
      [
        "dQw4w9WgXcQ",
        "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
        300
      ]
    ]
  },
  {
    name: "🌃 Dark Ambient",
    videos: [
      [
        "d9MyW72ELq0",
        "Avatar: The Way of Water | Official Trailer",
        300
      ],
      [
        "TcMBFSGVi1c",
        "Marvel Studios Avengers: Endgame - Official Trailer",
        300
      ],
      [
        "6ZfuNTqbHE8",
        "Marvel Studios Avengers: Infinity War Official Trailer",
        300
      ]
    ]
  },
  {
    name: "🎬 Movie Trailers",
    videos: [
      [
        "9K073PKBBs4",
        "Punjab Pind fs 25 😍 Tractors Modification Start karti  🚜 | Episode #3 x BrarTV",
        300
      ],
      [
        "twFWaOvlsuk",
        "Punjab Pind  in fs 25 😍 Mitti da kam start  🚜 | Episode #2 x BrarTV",
        300
      ],
      [
        "amjLzsek5K0",
        "Arjun NOVO  vs 🌾Jhone Wali Machine  in Fs 25 Indian Farming x BrarTV",
        300
      ]
    ]
  },
  {
    name: "🚜 Desi Farming",
    videos: [
      [
        "t0Q2otsqC4I",
        "Tom & Jerry | Tom & Jerry in Full Screen | Classic Cartoon Compilation | WB Kids",
        300
      ],
      [
        "jfKfPfyJRdk",
        "lofi hip hop radio 📚 beats to relax/study to",
        300
      ],
      [
        "4xDzrJKXOOY",
        "synthwave radio 🌌 beats to chill/game to",
        300
      ]
    ]
  },
  {
    name: "😹 Cartoon Classics",
    videos: [
      [
        "S_MOd40zlYU",
        "dark ambient radio 🌃 music to escape/dream to",
        300
      ],
      [
        "pElk1ShPrcE",
        "Ainvayi Ainvayi Song | Band Baaja Baaraat | Ranveer Singh, Anushka Sharma |  Sun",
        300
      ],
      [
        "5qap5aO4i9A",
        "lofi hip hop radio - beats to relax/study to",
        300
      ]
    ]
  },
  {
    name: "🔥 Bollywood Hits",
    videos: [
      [
        "dQw4w9WgXcQ",
        "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
        300
      ],
      [
        "d9MyW72ELq0",
        "Avatar: The Way of Water | Official Trailer",
        300
      ],
      [
        "TcMBFSGVi1c",
        "Marvel Studios Avengers: Endgame - Official Trailer",
        300
      ]
    ]
  },
  {
    name: "📚 Study With Me",
    videos: [
      [
        "6ZfuNTqbHE8",
        "Marvel Studios Avengers: Infinity War Official Trailer",
        300
      ],
      [
        "9K073PKBBs4",
        "Punjab Pind fs 25 😍 Tractors Modification Start karti  🚜 | Episode #3 x BrarTV",
        300
      ],
      [
        "twFWaOvlsuk",
        "Punjab Pind  in fs 25 😍 Mitti da kam start  🚜 | Episode #2 x BrarTV",
        300
      ]
    ]
  },
  {
    name: "💪 Workout Energy",
    videos: [
      [
        "amjLzsek5K0",
        "Arjun NOVO  vs 🌾Jhone Wali Machine  in Fs 25 Indian Farming x BrarTV",
        300
      ],
      [
        "t0Q2otsqC4I",
        "Tom & Jerry | Tom & Jerry in Full Screen | Classic Cartoon Compilation | WB Kids",
        300
      ],
      [
        "jfKfPfyJRdk",
        "lofi hip hop radio 📚 beats to relax/study to",
        300
      ]
    ]
  },
  {
    name: "🌊 Chill Waves",
    videos: [
      [
        "4xDzrJKXOOY",
        "synthwave radio 🌌 beats to chill/game to",
        300
      ],
      [
        "S_MOd40zlYU",
        "dark ambient radio 🌃 music to escape/dream to",
        300
      ],
      [
        "pElk1ShPrcE",
        "Ainvayi Ainvayi Song | Band Baaja Baaraat | Ranveer Singh, Anushka Sharma |  Sun",
        300
      ]
    ]
  },
  {
    name: "🎹 Piano Lounge",
    videos: [
      [
        "5qap5aO4i9A",
        "lofi hip hop radio - beats to relax/study to",
        300
      ],
      [
        "dQw4w9WgXcQ",
        "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
        300
      ],
      [
        "d9MyW72ELq0",
        "Avatar: The Way of Water | Official Trailer",
        300
      ]
    ]
  },
  {
    name: "🚗 Drive Mode",
    videos: [
      [
        "TcMBFSGVi1c",
        "Marvel Studios Avengers: Endgame - Official Trailer",
        300
      ],
      [
        "6ZfuNTqbHE8",
        "Marvel Studios Avengers: Infinity War Official Trailer",
        300
      ],
      [
        "9K073PKBBs4",
        "Punjab Pind fs 25 😍 Tractors Modification Start karti  🚜 | Episode #3 x BrarTV",
        300
      ]
    ]
  },
  {
    name: "☕ Morning Coffee",
    videos: [
      [
        "twFWaOvlsuk",
        "Punjab Pind  in fs 25 😍 Mitti da kam start  🚜 | Episode #2 x BrarTV",
        300
      ],
      [
        "amjLzsek5K0",
        "Arjun NOVO  vs 🌾Jhone Wali Machine  in Fs 25 Indian Farming x BrarTV",
        300
      ],
      [
        "t0Q2otsqC4I",
        "Tom & Jerry | Tom & Jerry in Full Screen | Classic Cartoon Compilation | WB Kids",
        300
      ]
    ]
  },
  {
    name: "🕺 Retro Hits",
    videos: [
      [
        "jfKfPfyJRdk",
        "lofi hip hop radio 📚 beats to relax/study to",
        300
      ],
      [
        "4xDzrJKXOOY",
        "synthwave radio 🌌 beats to chill/game to",
        300
      ],
      [
        "S_MOd40zlYU",
        "dark ambient radio 🌃 music to escape/dream to",
        300
      ]
    ]
  },
  {
    name: "🎺 Late Night",
    videos: [
      [
        "pElk1ShPrcE",
        "Ainvayi Ainvayi Song | Band Baaja Baaraat | Ranveer Singh, Anushka Sharma |  Sun",
        300
      ],
      [
        "5qap5aO4i9A",
        "lofi hip hop radio - beats to relax/study to",
        300
      ],
      [
        "dQw4w9WgXcQ",
        "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
        300
      ]
    ]
  },
  {
    name: "🌸 Feel Good",
    videos: [
      [
        "d9MyW72ELq0",
        "Avatar: The Way of Water | Official Trailer",
        300
      ],
      [
        "TcMBFSGVi1c",
        "Marvel Studios Avengers: Endgame - Official Trailer",
        300
      ],
      [
        "6ZfuNTqbHE8",
        "Marvel Studios Avengers: Infinity War Official Trailer",
        300
      ]
    ]
  },
  {
    name: "🎮 Gaming Vibes",
    videos: [
      [
        "9K073PKBBs4",
        "Punjab Pind fs 25 😍 Tractors Modification Start karti  🚜 | Episode #3 x BrarTV",
        300
      ],
      [
        "twFWaOvlsuk",
        "Punjab Pind  in fs 25 😍 Mitti da kam start  🚜 | Episode #2 x BrarTV",
        300
      ],
      [
        "amjLzsek5K0",
        "Arjun NOVO  vs 🌾Jhone Wali Machine  in Fs 25 Indian Farming x BrarTV",
        300
      ]
    ]
  },
  {
    name: "✨ Trending Now",
    videos: [
      [
        "t0Q2otsqC4I",
        "Tom & Jerry | Tom & Jerry in Full Screen | Classic Cartoon Compilation | WB Kids",
        300
      ],
      [
        "jfKfPfyJRdk",
        "lofi hip hop radio 📚 beats to relax/study to",
        300
      ],
      [
        "4xDzrJKXOOY",
        "synthwave radio 🌌 beats to chill/game to",
        300
      ]
    ]
  },
  {
    name: "🛕 Evening Calm",
    videos: [
      [
        "S_MOd40zlYU",
        "dark ambient radio 🌃 music to escape/dream to",
        300
      ],
      [
        "pElk1ShPrcE",
        "Ainvayi Ainvayi Song | Band Baaja Baaraat | Ranveer Singh, Anushka Sharma |  Sun",
        300
      ],
      [
        "5qap5aO4i9A",
        "lofi hip hop radio - beats to relax/study to",
        300
      ]
    ]
  },
  {
    name: "🎤 Party Mode",
    videos: [
      [
        "dQw4w9WgXcQ",
        "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
        300
      ],
      [
        "d9MyW72ELq0",
        "Avatar: The Way of Water | Official Trailer",
        300
      ],
      [
        "TcMBFSGVi1c",
        "Marvel Studios Avengers: Endgame - Official Trailer",
        300
      ]
    ]
  }
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
      update: {
        isBot: true,
        // Refresh on every run so avatar/bio changes actually take effect.
        avatar: PORTRAITS[BOT_NAMES.indexOf(name) % PORTRAITS.length],
        bio: 'Mehfil channel bot 🤖',
      },
      create: {
        googleId: `bot_${handle}`,
        name,
        username: `${handle}_bot`,
        email: `${handle}.bot@mehfil.local`,
        avatar: PORTRAITS[BOT_NAMES.indexOf(name) % PORTRAITS.length],
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
