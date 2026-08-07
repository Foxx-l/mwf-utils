# MWF Faction Bot — Roadmap

This document outlines planned features and improvements for the bot.
Items are grouped by priority and complexity.

---

## ✅ Completed

- Faction selection embed (Allies / Axis buttons with role assignment)
- Custom emoji auto-upload on startup (ALLIES, AXIS)
- Admin panel (`/panel`) — Reset Roles, Reload Embed, Clear Logs
- Weekly auto-reset of faction roles every Wednesday at 22:00 (Warsaw time)
- Admin log channel — logs all faction selections and admin actions
- `/lineup` — post pre-made lineup image with Discord timestamps to lineup channel
- `/server` — post Server Details embed (server name + password) to dedicated channel
- `/edit lineup` — edit caption of the last lineup embed in-place
- `/edit server` — edit server name/password of the last server details embed in-place
- Channel restrictions for `/lineup` and `/server` commands via env vars
- Team Rep approval queue — posting in `TEAM_REP_CHANNEL` creates an approval
  card in the admin log channel (pinging `TEAM_REP_PING_ROLE`); admins approve
  or reject with buttons. `/teamrep add|remove` for manual management.
  - Tuning env vars: `TEAM_REP_COOLDOWN_MS`, `TEAM_REP_MAX_RETRIES`, `TEAM_REP_BACKOFF_BASE_MS`

---

## 🔜 Planned Features

### 1. Clan Tag Automation
**Priority:** High  
**Channel:** `#request-clan-tag`

Players write their clan tag in the request channel (e.g. `DD`, `Ratz`, `Greyhounds`).
The bot reads the message, extracts the tag, and automatically updates the player's Discord nickname
to the format `[TAG] Username`.

**Details:**
- Bot parses the first word / bracket-wrapped tag from the message
- Updates the member's server nickname using `[TAG] Username` format
- Reacts with ✅ on success or ❌ on failure (e.g. insufficient permissions for admins)
- Logs the tag change to the admin log channel (user mention + old nickname → new nickname)
- If the user already has a tag, it is replaced
- Admins can trigger a tag update for another user via `/tag set @user [TAG]`
- `/tag remove @user` strips the tag from the user's nickname

---

## 💡 Future Ideas (Backlog)

- `/history` — admin command to view past weekly reset logs
- Automatic DM to players after faction selection with match schedule
- Slash command autocomplete for clan tags (based on known tags in the server)

---

## 🗓️ No Fixed Timeline

This project is maintained on a best-effort basis. Features will be implemented
based on community needs and available time. Pull requests are welcome!
