# Mehfil Backend — Deployment Guide
> Server: 187.124.213.14 | Domain: mehfil.microdesk.tech | Panel: CloudPanel

---

## Overview

Every push to `main` triggers GitHub Actions → SSH into server → pull → migrate → PM2 restart.

```
GitHub push → Actions workflow → SSH → git pull → npm ci → prisma migrate deploy → pm2 reload
```

---

## Step 1 — One-Time Server Setup

SSH into the server as root:
```bash
ssh root@187.124.213.14
```

### 1a. Install Node.js (via nvm — already likely installed)
```bash
# Check if node is available for the site user
su - microdesk-mehfil
node -v   # should be 18+ 
npm -v
```

If not installed:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
nvm alias default 20
```

### 1b. Install PM2 globally
```bash
npm install -g pm2
pm2 startup   # follow the printed command to enable PM2 on boot
```

### 1c. Clone the repo into the site directory
```bash
su - microdesk-mehfil
cd /home/microdesk-mehfil/htdocs/mehfil.microdesk.tech

# Remove the placeholder .well-known if it's the only thing there
# Then clone:
git clone https://github.com/sobanqazi69/mehfil_backend.git .
```

> The trailing `.` clones into the current directory.

### 1d. Create the .env file on the server
```bash
cd /home/microdesk-mehfil/htdocs/mehfil.microdesk.tech
cp .env.example .env
nano .env   # fill in all values
```

Fill in:
```env
DATABASE_URL="mysql://USER:PASSWORD@HOST:3306/mehfil_db"
REDIS_URL="rediss://default:PASSWORD@HOST:PORT"

JWT_SECRET="generate-with: openssl rand -hex 32"
JWT_EXPIRES_IN="1h"
JWT_REFRESH_SECRET="generate-with: openssl rand -hex 32"
JWT_REFRESH_EXPIRES_IN="30d"

GOOGLE_CLIENT_ID="xxx.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-xxx"

LIVEKIT_URL="wss://187.124.213.14"
LIVEKIT_API_KEY="your-livekit-api-key"
LIVEKIT_API_SECRET="your-livekit-api-secret"

PORT=3000
NODE_ENV=production
CLIENT_URL="https://mehfil.microdesk.tech"
```

### 1e. Install deps + run first migration
```bash
npm ci --omit=dev
npx prisma generate
npx prisma migrate deploy
```

### 1f. Start the app with PM2
```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 logs mehfil_backend   # verify it started cleanly
```

---

## Step 2 — CloudPanel Nginx Reverse Proxy

In CloudPanel, go to **Sites → mehfil.microdesk.tech → Vhost** and add this inside the `server {}` block (or use the Node.js proxy option if CloudPanel has it):

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;

    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_cache_bypass $http_upgrade;
    proxy_read_timeout 86400s;
}
```

The `proxy_read_timeout 86400s` is required for Socket.io long-polling connections.

After saving, reload nginx:
```bash
sudo service nginx reload
# or in CloudPanel UI: Vhost → Save
```

---

## Step 3 — GitHub Secrets Setup

Go to **GitHub → mehfil_backend → Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value |
|---|---|
| `SSH_HOST` | `187.124.213.14` |
| `SSH_USER` | `microdesk-mehfil` |
| `SSH_PRIVATE_KEY` | *(contents of your private SSH key — see below)* |
| `SSH_PORT` | `22` |

### Generating the SSH key pair

Run this **on your local machine**:
```bash
ssh-keygen -t ed25519 -C "github-actions-mehfil" -f ~/.ssh/mehfil_deploy
```

This creates:
- `~/.ssh/mehfil_deploy` → **private key** → paste into `SSH_PRIVATE_KEY` secret
- `~/.ssh/mehfil_deploy.pub` → **public key** → add to server

### Adding the public key to the server
```bash
# On the server, as microdesk-mehfil user:
cat >> /home/microdesk-mehfil/.ssh/authorized_keys << 'EOF'
<paste contents of ~/.ssh/mehfil_deploy.pub here>
EOF

chmod 700 /home/microdesk-mehfil/.ssh
chmod 600 /home/microdesk-mehfil/.ssh/authorized_keys
```

### Test the connection locally before pushing
```bash
ssh -i ~/.ssh/mehfil_deploy microdesk-mehfil@187.124.213.14
```

---

## Step 4 — Trigger First Deploy

```bash
git push origin main
```

Watch it run: **GitHub → mehfil_backend → Actions tab**

---

## Useful Server Commands

```bash
# View live logs
pm2 logs mehfil_backend

# View app status
pm2 status

# Manual restart
pm2 restart mehfil_backend

# Check nginx errors
sudo tail -f /var/log/nginx/error.log

# Check CloudPanel site logs
tail -f /home/microdesk-mehfil/logs/error.log
```

---

## How Auto-Deploy Works

```
1. You push code to main branch
2. GitHub Actions triggers the deploy.yml workflow
3. It SSHs into 187.124.213.14 as microdesk-mehfil
4. cd /home/microdesk-mehfil/htdocs/mehfil.microdesk.tech
5. git pull origin main          ← gets new code
6. npm ci --omit=dev             ← installs prod deps only
7. npx prisma generate           ← rebuilds Prisma client
8. npx prisma migrate deploy     ← applies new migrations safely
9. pm2 reload ecosystem.config.js --env production  ← zero-downtime restart
10. pm2 save                     ← persists process list
```

`pm2 reload` does a **zero-downtime restart** — old process keeps serving requests while the new one starts up.

---

## Rollback

If a deploy breaks production:
```bash
ssh microdesk-mehfil@187.124.213.14

cd /home/microdesk-mehfil/htdocs/mehfil.microdesk.tech

# Revert to previous commit
git log --oneline -5          # find the last good commit hash
git checkout <commit-hash>

# Restart
pm2 restart mehfil_backend
```
