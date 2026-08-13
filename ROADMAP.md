# MWF Faction Bot — Roadmap

This document outlines planned features and improvements for the bot.
Items are grouped by priority and complexity.

---

## ✅ Completed

- Faction selection embed (Allies / Axis buttons with role assignment)
- Custom emoji auto-upload on startup (ALLIES, AXIS)
- Admin panel (`/panel`) — Reset Roles, Reload Embed, Clear Logs
- Weekly auto-reset of faction roles every Wednesday at 22:00 (Warsaw time),
  after the match
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
- Mid Cap Poll — native Discord poll in `MIDCAP_CHANNEL` for the next match's mid cap.
  Options come from the rotation's scheduled map; Discord counts the votes and the poll
  closes at kick-off. Eligibility is handled by channel permissions, not by the bot.
  - Mid caps of all 20 maps live in `src/config/midCaps.js` (from the MWF data sheet)
  - One poll per match, tracked in `data/midcap_polls.json`; the previous poll is ended
    when a new one is posted
  - Posted from `/panel`, and by the scheduler in the post-match slot (22:05
    Warsaw by default), so the next match's vote opens right after the current
    match; never on startup
  - Optional env var: `MIDCAP_CHANNEL` (unset disables the feature). The bot needs
    **Send Polls** in that channel.
- Clan Tag Automation — ported from the standalone TagSelector bot. Members set their
  own `[TAG] Name` nickname prefix with `/tag set` (autocompleted) and drop it with
  `/tag remove`; admins manage the list and other members' tags with
  `/tags list|add|remove|post|set|clear`.
  - Tag list persists in `data/tags_data.json`; matching tag roles are granted by role **name**
  - Every change is logged to `ADMIN_LOG_CHANNEL` (member + tag + old → new nickname)
  - Requires the bot to have **Manage Nicknames**; optional env var `TAG_CHANNEL`
  - Implemented in `src/utils/tagStore.js`, `src/handlers/interactions/tagHandler.js`,
    `src/commands/member/tag.js`, `src/commands/admin/tags.js`
  - Deviation from the original plan: the tag is chosen from a curated, autocompleted
    list instead of parsed out of free-text messages in a request channel, so members
    can't invent tags for clans they don't belong to.

- Per-clan RaidHelper signups — one permanent category (`SIGNUP_CATEGORY_NAME`,
  default "MWF Signups") holding a private `#signup-<tag>` channel per clan tag
  (visible via the role named like the tag) plus a public `#signup-solo`. Each
  match day gets one RaidHelper event per channel, created through the RaidHelper
  API (`POST /api/v4/servers/{id}/channels/{id}/event`; templates 24/23 by default).
  - Managed from `/panel` → Panel utils → **Signups — manage**: post now, cancel
    (with confirm), auto-post toggle, channel sync, status row in the main panel
  - Auto-posted in the post-match slot (22:10 Warsaw by default) when enabled;
    idempotent per (date, clan) via `data/signups_data.json`, so ticks and clicks
    never double-post
  - Feature is enabled by setting `RAIDHELPER_API_KEY`; RaidHelper's bot gets an
    explicit overwrite in the private channels via `RAIDHELPER_BOT_ID`
  - Implemented in `src/utils/raidhelper.js`, `src/utils/signupStore.js`,
    `src/handlers/interactions/signupHandler.js`

---

## 💡 Future Ideas (Backlog)

- `/history` — admin command to view past weekly reset logs
- Automatic DM to players after faction selection with match schedule
- Clan tags in `/panel` — status row plus a "Post Tag Info" action, so the info
  embed is managed like the other embeds instead of only via `/tags post`

---

## 🗓️ No Fixed Timeline

This project is maintained on a best-effort basis. Features will be implemented
based on community needs and available time. Pull requests are welcome!
