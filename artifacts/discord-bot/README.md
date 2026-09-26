# 🦈 Bow Down Visuals — Discord Live Companion Bot

A long-running discord.js service that watches your Discord server for **Go Live**
and automates everything around the stream:

- **Go-live detection** — `VOICE_STATE_UPDATE` with `self_stream: true` fires the instant you click Go Live (official gateway event, no privileged intents)
- **Auto-announcement** — rich gold embed in your announcements channel + watch-party thread
- **Stream-end recap** — duration + "thanks for hanging" post
- **Slash commands** — `/live` (are they live?), `/next` (schedule), `/socials` (links)
- **Live state sync** — every transition is POSTed to the api-server so bowdownvisuals.com shows a LIVE badge
- **Streaming presence** — bot shows a "Streaming" status pointing at your stream URL

## What the user needs to do (one time, ~5 minutes)

### 1. Create the Discord application
1. Go to <https://discord.com/developers/applications> → **New Application** → name it "Bow Down Visuals"
2. **General Information** → copy the **Application ID** → this is `DISCORD_CLIENT_ID`
3. **Bot** → **Reset Token** → copy the token → this is `DISCORD_BOT_TOKEN`
   - Turn OFF "Public Bot" if you only want it on your server (optional)
   - No privileged intents needed — leave them off
4. **OAuth2 → General** → add redirect URL: `https://bowdownvisuals.com/api/auth/callback/discord`
   (Supabase handles the actual OAuth exchange; see "Discord login" below)

### 2. Install the bot on your server
Use the install link from the site's **/discord-bot** admin page (it builds the
OAuth2 URL with the right permissions), or manually:
`https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=397284945728&scope=bot%20applications.commands`
- You must have **Manage Server** permission on the server
- Note the **channel ID** where announcements should post (right-click channel → Copy Channel ID; enable Developer Mode first)
- Note your **server ID** (right-click server → Copy Server ID)
- Note **your own Discord user ID** (right-click yourself → Copy User ID)

### 3. Set environment variables
On the bot service (see Hosting below) and on the api-server:

| Variable | Where | Value |
|---|---|---|
| `DISCORD_BOT_TOKEN` | bot service only | Bot token from step 1 |
| `DISCORD_CLIENT_ID` | bot + api-server | Application ID from step 1 |
| `DISCORD_BOT_SHARED_SECRET` | bot + api-server | Random 32+ char string (generate: `openssl rand -hex 32`) |
| `DISCORD_GUILD_ID` | bot (optional) | Your server ID — registers slash commands instantly instead of up to 1h |
| `DISCORD_ANNOUNCE_CHANNEL_ID` | bot (fallback) | Announcements channel ID |
| `STREAMER_DISCORD_USER_ID` | bot (fallback) | Your Discord user ID — the bot only announces for this user |
| `API_BASE_URL` | bot | `https://bowdownvisuals.com` (default) |
| `SOCIALS_LINKS` | bot (optional) | `YouTube\|https://…,TikTok\|https://…` for the `/socials` command |
| `STREAM_URL` | bot (optional) | Twitch/YouTube URL for the bot's "Streaming" presence |

### 4. Wire it up on the site
1. Run migration `lib/db/migrations/0029_discord_bot.sql` against production Postgres
2. Visit **/discord-bot** on the site (admin only) → paste guild ID, announce channel ID, your Discord user ID → Save
3. The bot auto-announces from the next Go Live. Zero change to how you stream.

### Discord login (separate, 2 minutes)
1. Discord portal → **OAuth2 → General** → **Client Secret** → Reset Secret → copy
2. **Supabase dashboard** → Authentication → Providers → enable **Discord** → paste Client ID + Client Secret
3. Add `https://<your-supabase-ref>.supabase.co/auth/v1/callback` to Discord's redirect URLs
4. The site's "Continue with Discord" buttons work immediately — no code changes

## Hosting

**Option A — Render Background Worker (recommended):**
1. Render dashboard → New → Background Worker → connect the repo
2. Build command: `cd artifacts/discord-bot && npm install && npm run build`
3. Start command: `cd artifacts/discord-bot && npm start`
4. Add the env vars from the table above. Deploys on every push.

**Option B — sidecar in the existing Docker image:**
The main Dockerfile could start the bot alongside the api-server
(e.g. `node artifacts/discord-bot/dist/index.js & node artifacts/api-server/dist/index.js`),
but a separate worker is cleaner: independent restarts, independent scaling,
and the bot staying up even if the web service redeploys.

## Local dev

```bash
cd artifacts/discord-bot
npm install
cp .env.example .env   # fill in your values
npm run dev            # tsx watch-less runner
```

## Security notes

- The bot token is a full credential: it lives **only** in the bot service's env, never in the repo, never in the browser
- Bot→API auth uses `DISCORD_BOT_SHARED_SECRET` (header `x-bot-secret`); the api-server rejects writes when the secret is unset or mismatched (fail closed)
- The bot never sends video and never automates a user account — 100% official APIs
