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

### 2. Team Rep Role Automation
**Priority:** High  
**Channel:** `#request-team-rep-role`

Players post in the request channel to identify themselves as a team representative.
The bot automatically assigns the configured `Team Rep` role.

**Details:**
- Bot listens for new messages in the designated channel (`TEAM_REP_CHANNEL` in `.env`)
- Assigns the `TEAM_REP_ROLE_ID` role to the message author
- Reacts with ✅ on success
- Logs the role assignment to the admin log channel
- If the user already has the role, bot skips and reacts with ℹ️
- Admins can manually assign/remove the role via `/teamrep add @user` and `/teamrep remove @user`

---

### 3. Squad Signup System
**Priority:** Medium  
**Complexity:** High

An interactive embed allowing players to sign up for specific squad roles in an upcoming match.
Inspired by existing tools like Comp.gg — but native to Discord.

**Signup Categories:**
| Category    | Icon | Notes                          |
|-------------|------|--------------------------------|
| Commander   | 🎖️  | Limited slots (e.g. 1–2)      |
| Infantry    | 🗣️  | Largest category               |
| Tank        | 🛡️  | Medium slots                   |
| Recon       | 🔭  | Limited slots                  |
| Artillery   | 💥  | Limited slots                  |
| Bench       | 🪑  | Reserve / overflow              |

**Embed displays:**
- Total signups vs. capacity (e.g. `20 / 49`)
- Match date and time with Discord timestamps
- Countdown until match start (e.g. `in 7 days`)
- Per-category player list with slot numbers
- Slot numbers assigned in registration order

**Commands:**
- `/signup create` — Admin creates a new signup embed (sets date, time, capacity per category)
- `/signup close` — Admin closes signups (no more entries accepted)
- `/signup reset` — Admin clears all signups

**Buttons (on the embed):**
- One button per category — clicking opens a confirmation or position-select modal
- `Bench` button for overflow
- `⚙️` Settings button (admin only) — edit match details or manage slots

**Additional:**
- A player can only be signed up in one category at a time
- Switching category removes the player from their previous slot
- All signup data persists in a lightweight JSON file or SQLite (no external DB required)

---

## 💡 Future Ideas (Backlog)

- `/history` — admin command to view past weekly reset logs
- Automatic DM to players after faction selection with match schedule
- Slash command autocomplete for clan tags (based on known tags in the server)

---

## 🗓️ No Fixed Timeline

This project is maintained on a best-effort basis. Features will be implemented
based on community needs and available time. Pull requests are welcome!
