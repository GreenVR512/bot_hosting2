# Project Overview

This project contains a Mineflayer Minecraft bot and a CraftHost dashboard. Run the dashboard with `npm start`; it starts the real bot and serves the control panel on port 5000. Run `node bot.js` to use the bot directly from a terminal.

The dashboard uses these environment variables when present:

- `MC_HOST`
- `MC_PORT`
- `MC_USERNAME`
- `MC_VERSION`
- `MC_AUTH` (`offline` for offline-mode servers, or `microsoft` for Microsoft authentication)

## User Preferences

- Keep the bot configuration straightforward and easy to edit.