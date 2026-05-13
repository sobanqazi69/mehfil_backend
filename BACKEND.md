# Mehfil Backend — Development Plan
> Node.js + Express + Socket.io + Prisma (MySQL) + Redis
> All real-time, auth, room, video sync, voice, and chat logic lives here.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Runtime | Node.js 20+ | Server runtime |
| Framework | Express 5 | REST API |
| Real-time | Socket.io 4 | Room events, sync, chat, mic |
| ORM | **Prisma** | Type-safe MySQL queries + migrations |
| Database | MySQL 8 (PlanetScale / Railway) | Persistent data |
| Cache | Redis (Upstash) via ioredis | Live room state |
| Auth | google-auth-library + JWT | Google OAuth + session tokens |
| Validation | Zod | Request body validation |
| Voice tokens | livekit-server-sdk | Generate LiveKit JWT tokens |
| Security | helmet + express-rate-limit + cors | HTTP hardening |
| Logging | morgan (dev) + custom logger | Request + event logs |

---

## Folder Structure

```
mehfil_backend/
├── prisma/
│   ├── schema.prisma          ← Single source of truth for all models
│   ├── migrations/            ← Auto-generated migration files (commit these)
│   └── seed.js                ← Dev seed data (optional)
│
├── src/
│   ├── index.js               ← HTTP server + Socket.io boot + DB connect
│   ├── app.js                 ← Express app, middleware, routes mount
│   │
│   ├── config/
│   │   ├── database.js        ← Prisma client singleton
│   │   └── redis.js           ← Upstash Redis client (ioredis)
│   │
│   ├── routes/
│   │   ├── index.js           ← Aggregates all route modules under /api
│   │   ├── auth.routes.js     ← POST /auth/google, POST /auth/refresh
│   │   ├── user.routes.js     ← GET/PATCH /users/me
│   │   ├── room.routes.js     ← CRUD /rooms + /rooms/:id/messages
│   │   └── voice.routes.js    ← POST /voice/token (LiveKit)
│   │
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── user.controller.js
│   │   ├── room.controller.js
│   │   └── voice.controller.js
│   │
│   ├── middleware/
│   │   ├── auth.middleware.js     ← JWT Bearer token verification
│   │   └── validate.middleware.js ← Zod schema validation wrapper
│   │
│   ├── sockets/
│   │   ├── index.js               ← Socket.io server init + JWT auth middleware
│   │   └── room.socket.js         ← All room/video/chat/mic event handlers
│   │
│   └── utils/
│       ├── jwt.utils.js           ← signAccess, signRefresh, verifyAccess, verifyRefresh
│       ├── livekit.utils.js       ← buildLiveKitToken (rooms namespaced mehfil_room_*)
│       └── logger.js              ← Lightweight console logger
│
├── .env                       ← Local secrets (never commit)
├── .env.example               ← Template for all required env vars
├── .gitignore
├── package.json
└── BACKEND.md                 ← This file
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in all values before running.

```env
# Database
DATABASE_URL="mysql://USER:PASSWORD@HOST:3306/mehfil_db"

# Redis (Upstash — use rediss:// for TLS)
REDIS_URL="rediss://default:PASSWORD@HOST:PORT"

# JWT
JWT_SECRET="min-32-char-random-string"
JWT_EXPIRES_IN="1h"
JWT_REFRESH_SECRET="different-min-32-char-random-string"
JWT_REFRESH_EXPIRES_IN="30d"

# Google OAuth (from Google Cloud Console)
GOOGLE_CLIENT_ID="xxx.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-xxx"

# LiveKit (shared server — rooms prefixed mehfil_room_ to isolate from Bazmi)
LIVEKIT_URL="wss://187.124.213.14"
LIVEKIT_API_KEY="your-livekit-api-key"
LIVEKIT_API_SECRET="your-livekit-api-secret"

# Server
PORT=3000
NODE_ENV=development
CLIENT_URL="http://localhost:3001"
```

---

## Prisma — Migration Management

Prisma is the **single source of truth** for the database schema.
Never write raw SQL migrations by hand — always go through Prisma.

### Schema file
```
prisma/schema.prisma
```
Edit this file to change models. Prisma generates type-safe client code from it.

### Migration commands

| Command | When to use |
|---|---|
| `npm run db:migrate` | Add/change a model in dev — creates migration file + applies it |
| `npm run db:migrate:prod` | Deploy to production — applies pending migrations only, no reset |
| `npm run db:push` | Quick schema push without migration file (prototyping only) |
| `npm run db:studio` | Open Prisma Studio GUI to browse/edit data |
| `npm run db:reset` | Wipe dev DB + re-run all migrations (dev only — destructive) |
| `npm run generate` | Regenerate Prisma client after manual schema edits |

### Migration workflow (step by step)

```bash
# 1. Edit prisma/schema.prisma (add a field, a model, an index, etc.)

# 2. Create and apply the migration in dev
npm run db:migrate
# Prisma will prompt: "Name this migration" → e.g. "add_room_category"
# This creates: prisma/migrations/20240101_add_room_category/migration.sql

# 3. Commit the migration file with your code
git add prisma/migrations
git commit -m "prisma: add room category field"

# 4. On production deploy
npm run db:migrate:prod
# Only applies unapplied migrations — safe for production
```

### Rules
- **Always commit migration files** — they are the audit trail of every schema change.
- **Never delete a migration** — roll forward with a new migration instead.
- **`db:push` is for prototyping only** — it does not create migration files and cannot be deployed safely.
- **`db:reset` is dev-only** — it wipes all data.

---

## REST API Reference

### Base URL
```
http://localhost:3000/api
```

### Auth — `/api/auth`

| Method | Endpoint | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/auth/google` | None | `{ idToken }` | `{ accessToken, refreshToken, user }` |
| POST | `/auth/refresh` | None | `{ refreshToken }` | `{ accessToken }` |

Rate limited: 20 requests per 15 minutes on `/auth/google`.

### Users — `/api/users`

| Method | Endpoint | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/users/me` | JWT | — | User object |
| PATCH | `/users/me` | JWT | `{ name?, avatar? }` | Updated user |

### Rooms — `/api/rooms`

| Method | Endpoint | Auth | Query/Body | Response |
|---|---|---|---|---|
| GET | `/rooms` | JWT | `?page=1&category=cricket` | `{ rooms, total, page, pages }` |
| GET | `/rooms/my` | JWT | — | Array of rooms |
| POST | `/rooms` | JWT | `{ name, isPublic?, category? }` | Created room |
| GET | `/rooms/:id` | JWT | — | Room with members |
| DELETE | `/rooms/:id` | JWT (host only) | — | `{ message }` |
| GET | `/rooms/:id/messages` | JWT | — | Last 50 messages |

### Voice (LiveKit) — `/api/voice`

> Rooms on the shared LiveKit server (187.124.213.14) are namespaced as `mehfil_room_{id}`
> to stay completely isolated from other apps (e.g. Bazmi) on the same server.

| Method | Endpoint | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/voice/token` | JWT | `{ roomId }` | `{ token, roomName, livekitUrl }` |

---

## Socket.io Events Reference

### Connection
```javascript
// Client connects with JWT
const socket = io('http://localhost:3000', {
  auth: { token: '<accessToken>' }
});
```

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `room:join` | `{ roomId }` | Join a room, receive video snapshot |
| `room:leave` | `{ roomId }` | Leave a room cleanly |
| `video:load` | `{ roomId, youtubeId }` | Host loads new video |
| `video:sync` | `{ roomId, timestamp, isPlaying }` | Host play/pause/seek |
| `chat:send` | `{ roomId, text }` | Send a chat message |
| `mic:toggle` | `{ roomId, isMuted }` | Toggle own mic |
| `mic:mute_all` | `{ roomId }` | Host mutes everyone |

### Server → Client

| Event | Payload | Trigger |
|---|---|---|
| `room:members` | `{ members: [{ userId, name, avatar, isMuted }] }` | Any join/leave |
| `video:state` | `{ youtubeId, timestamp, isPlaying, updatedAt }` | Load/sync/new joiner |
| `chat:message` | `{ id, userId, name, avatar, text, createdAt }` | New message |
| `mic:state` | `{ userId, isMuted }` | Mic toggled |
| `mic:muted_all` | — | Host muted all |
| `room:error` | `{ message }` | Error for this socket |

---

## Redis Key Schema

```
room:{roomId}:state      → JSON string: { youtubeId, timestamp, isPlaying, updatedAt }
room:{roomId}:members    → Redis Set of userId strings
```

All room state is read from Redis on join (instant catch-up for new joiners).
MySQL stores the long-term state; Redis stores what's live right now.

---

## Development Phases

### Phase 1 — Foundation (Week 1)
**Goal:** Project boots, DB connected, migrations run.

- [x] Express app skeleton (`app.js` + `src/index.js`)
- [x] Prisma schema with all 4 models
- [x] Prisma client singleton
- [x] Redis client singleton
- [x] Logger utility
- [x] JWT utility (sign + verify)
- [x] Middleware: `authenticate`, `validate`
- [x] `.env.example` with all vars documented
- [x] Scripts: `dev`, `start`, `db:migrate`, `db:studio`, `db:reset`
- [ ] Connect to real MySQL (PlanetScale or Railway)
- [ ] Run first migration: `npm run db:migrate -- --name init`
- [ ] Verify `npm run dev` starts without errors

### Phase 2 — Google Auth + JWT (Week 2)
**Goal:** Flutter app can log in and get a JWT.

- [x] `POST /auth/google` — verify idToken, upsert user, return JWT pair
- [x] `POST /auth/refresh` — refresh access token
- [x] `GET /users/me` — get current user
- [x] `PATCH /users/me` — update name/avatar
- [ ] Test auth flow with a real Google idToken (use Postman or a test script)
- [ ] Verify JWT is accepted in `authenticate` middleware
- [ ] Verify rate limiting works on `/auth/google`

### Phase 3 — Room CRUD + Socket.io (Weeks 3–4)
**Goal:** Rooms can be created, joined, and left. Member list syncs in real time.

- [x] `GET /rooms` — paginated public rooms browse
- [x] `GET /rooms/my` — my rooms
- [x] `POST /rooms` — create room
- [x] `GET /rooms/:id` — room detail with members
- [x] `DELETE /rooms/:id` — host-only delete
- [x] Socket.io init with JWT auth middleware
- [x] `room:join` — DB upsert + Redis set + member broadcast
- [x] `room:leave` — DB delete + Redis remove + member broadcast
- [x] `disconnect` — auto-leave all rooms on disconnect
- [ ] Test: 2 clients join same room, both see updated member list
- [ ] Test: disconnect cleans up DB + Redis correctly

### Phase 4 — YouTube Sync (Weeks 5–6)
**Goal:** Host loads + controls video; all clients stay in sync.

- [x] `video:load` — host sets video, persists to Redis + DB, broadcasts state
- [x] `video:sync` — host sends timestamp + playing state, broadcasts to room
- [x] New joiner receives current video state snapshot from Redis on `room:join`
- [ ] Test: host loads video → all clients receive `video:state`
- [ ] Test: host seeks → all clients jump to same timestamp
- [ ] Test: new joiner gets correct state mid-stream
- [ ] Edge case: host leaves → new host election (Phase 2 feature, skip for MVP)

### Phase 5 — Voice / LiveKit (Week 7)
**Goal:** Flutter gets LiveKit token; mic toggle broadcasts to room.

> Uses shared LiveKit server at 187.124.213.14. Rooms are namespaced `mehfil_room_{id}`
> — completely isolated from Bazmi and any other app on the same server.

- [x] `POST /voice/token` — generate short-lived LiveKit JWT token
- [x] `mic:toggle` — update DB + broadcast `mic:state`
- [x] `mic:mute_all` — host mutes everyone, broadcasts `mic:muted_all`
- [ ] Get LiveKit API key/secret from server and add to `.env`
- [ ] Test token generation — verify Flutter can connect to LiveKit room
- [ ] Verify token expiry is 1 hour
- [ ] Verify room name prefix `mehfil_room_` does not collide with Bazmi rooms
- [ ] Verify `mic:mute_all` is host-only

### Phase 6 — Chat (Week 8)
**Goal:** Real-time chat works; last 50 messages loadable on join.

- [x] `chat:send` — persist to DB, broadcast `chat:message`
- [x] `GET /rooms/:id/messages` — last 50 messages for initial load
- [ ] Test: message sent → all clients in room receive it
- [ ] Test: new joiner loads existing messages via REST on `room:join`
- [ ] Verify 500-char limit enforced server-side

### Phase 7 — Hardening (Week 9)
**Goal:** Safe to deploy, tested under load.

- [ ] Input sanitisation audit (no raw user data in queries)
- [ ] Add `express-rate-limit` to remaining routes
- [ ] Load test Socket.io with 50 concurrent connections
- [ ] Add Prisma error handling for unique constraint violations
- [ ] Add health check endpoint (`GET /health`)
- [ ] Structured error responses consistent across all routes
- [ ] Review all `hostId !== req.user.id` guards

### Phase 8 — Production Deploy (Week 10)
**Goal:** Live URL, real DB, SSL, monitoring.

- [ ] Provision MySQL on PlanetScale or Railway
- [ ] Provision Redis on Upstash
- [ ] Deploy Node.js to Railway or Render
- [ ] Set all env vars in production dashboard
- [ ] Run `npm run db:migrate:prod` on production
- [ ] Verify `/health` returns 200
- [ ] Configure custom domain + SSL
- [ ] Set up basic uptime monitoring (UptimeRobot)

---

## npm Scripts Reference

```bash
npm run dev              # Start with nodemon (auto-restart on file change)
npm start                # Start for production

npm run db:migrate       # Create + apply a new migration (dev)
npm run db:migrate:prod  # Apply pending migrations (production)
npm run db:push          # Push schema changes without migration (prototyping only)
npm run db:studio        # Open Prisma Studio at localhost:5555
npm run db:reset         # Wipe DB + replay all migrations (dev only)
npm run generate         # Regenerate @prisma/client after schema edit
```

---

## First-Time Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill environment variables
cp .env.example .env
# Edit .env with your DB URL, Redis URL, JWT secrets, etc.

# 3. Generate Prisma client
npm run generate

# 4. Run initial migration (creates all tables)
npm run db:migrate
# Enter migration name: "init"

# 5. Start dev server
npm run dev
# → [DB] Prisma connected
# → [Redis] Connected
# → [Server] Running on port 3000 (development)

# 6. Verify health check
curl http://localhost:3000/health
# → { "status": "ok", "timestamp": "..." }
```
