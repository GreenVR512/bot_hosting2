# Project Overview

This project contains a Mineflayer Minecraft bot and a CraftHost dashboard. The application files live in `public/`:

- `public/index.js` — application entry point
- `public/server.js` — dashboard API and web server
- `public/bot.js` — Mineflayer bot controller
- `public/index.html` — dashboard UI

Run the dashboard with `npm start`; it starts the real bot and serves the control panel on port 5000. Run `node public/bot.js` to use the bot directly from a terminal.

The dashboard uses these environment variables when present:

- `MC_HOST`
- `MC_PORT`
- `MC_USERNAME`
- `MC_VERSION`
- `MC_AUTH` (`offline` for offline-mode servers, or `microsoft` for Microsoft authentication)

## User Preferences

- Keep the bot configuration straightforward and easy to edit.