# Owltopia Discord reply bot (Railway)

Always-on Gateway worker that replies when someone **@mentions Owltopia Bot** or **replies to its messages** in configured channels.

Uses the same `DISCORD_BOT_TOKEN` as the main site (REST posts + slash commands). Railway runs the WebSocket listener; Vercel stays HTTP-only.

## Discord Developer Portal

1. Open your application → **Bot**.
2. Enable **Message Content Intent** (Privileged Gateway Intents).
3. Ensure the bot is in the Owltopia server with **View Channel**, **Send Messages**, **Read Message History** in public/holder channels.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | yes | Same bot token as production |
| `DISCORD_GUILD_ID` | yes | Owltopia server id |
| `DISCORD_REPLY_CHANNEL_IDS` | recommended | Comma-separated channel ids (public + holder). If unset, all guild text channels. |
| `NEXT_PUBLIC_SITE_URL` or `OWLTOPIA_SITE_URL` | no | Default `https://www.owltopia.xyz` — used for presale/raffle links |
| `DISCORD_REPLY_ENABLED` | no | `false` to pause without stopping the process |
| `DISCORD_REPLY_COOLDOWN_SEC` | no | Per-user cooldown (default `30`) |
| `PORT` | no | Health check port (Railway sets this) |

Example:

```env
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=1447301649478455499
DISCORD_REPLY_CHANNEL_IDS=1450187152888692736,1458592027586592798
NEXT_PUBLIC_SITE_URL=https://www.owltopia.xyz
```

## Railway deploy

1. **New Project** → **Deploy from GitHub** → this repo.
2. **Settings → Root Directory:** `workers/discord-reply-bot`
3. **Build command:** `npm install`
4. **Start command:** `npm start`
5. Add the env vars above (copy from Vercel / `.env.local`).
6. Deploy. Health check: `GET /` on `PORT` returns JSON `{ ok, ready, user }`.

## Local dev

From repo root:

```bash
cd workers/discord-reply-bot
npm install
# Uses ../../.env.local if DISCORD_BOT_TOKEN is not set in the shell
npm run dev
```

## Behavior (v1)

- Responds on **@mention** or **reply to bot** only (no random keyword scanning).
- **Mint / presale** prompts → live stats from `GET /api/gen2-presale/stats`.
- **Raffle** prompts → link to `/raffles`.
- Default → short links to presale + raffles.
- No @mentions in replies (avoids ping loops).
- Per-user cooldown to reduce spam.

## Notes

- This does **not** replace Owl Vision **Discord broadcast** (scheduled/admin posts on Vercel).
- For new holder channel ids after a rename, update `DISCORD_REPLY_CHANNEL_IDS` on Railway (names do not matter, ids do).
