# Ludo Arena — Phase 1

Premium Telegram Mini App dashboard starter for Ludo Arena.

## Included in Phase 1
- Telegram bot `/start` with an Open Mini App button.
- Responsive dark purple / neon violet / royal gold dashboard.
- Home, game modes overview, profile, leaderboard, settings, and help screens.
- Telegram Mini App SDK initialization and server-side `initData` verification.
- MongoDB Atlas connection and initial user profile upsert.
- Health endpoint and Heroku `Procfile`.

## Not included yet
The playable Ludo board, dice engine, AI, matchmaking, private rooms, and multiplayer synchronization are intentionally reserved for later phases. The mode cards clearly identify these as upcoming rather than pretending they already work.

## Requirements
- Node.js 20+
- Telegram bot token from BotFather
- MongoDB Atlas connection URI
- Heroku app URL configured as the bot's Mini App URL

## Local setup
1. Copy `.env.example` to `.env`.
2. Fill `BOT_TOKEN`, `MONGODB_URI`, `MONGODB_DB_NAME`, and `WEB_APP_URL`.
3. Install and run:

```bash
npm install
npm start
```

4. Open `http://localhost:3000/` to preview the dashboard. Telegram authentication only works when launched through Telegram; localhost preview is provided for UI review.

## Heroku setup
Set the Config Vars from `.env.example` in Heroku Settings → Config Vars, then deploy this repository. Ensure `WEB_APP_URL` is the exact HTTPS URL of the deployed app. Configure the bot's menu button / Mini App URL with BotFather or your bot setup.

## Security notes
- Never commit `.env`.
- The API verifies Telegram Web App `initData` using the bot token and rejects stale sessions older than 24 hours.
- User identity is taken from verified Telegram `initData`, not a client-supplied Telegram ID, for profile creation.
- The profile GET route is a Phase 1 convenience endpoint and should be upgraded to authenticated session/token access before exposing private player statistics publicly.
