# MWF Faction Bot

Discord bot for **Midweek Frontline** — faction selection, lineups, server
details, map rotation, and node info, all driven from a single admin panel.

## Features

- **Faction selection** — persistent embed with Allies/Axis buttons for S1 and
  S2, with a per-user cooldown to prevent role-swap spam.
- **Weekly auto-reset** — clears all faction roles every Wednesday at
  22:00 Europe/Warsaw, once the match has been played (configurable).
- **`/panel` admin control** — one status row per feature with its own action
  button, grouped dropdowns for the rest, and a redraw after every action.
- **Lineup posting** (`/lineup`) — post a pre-made lineup image for S1 or S2
  with auto-calculated Wednesday timestamps.
- **Server details** — post and edit server name/password for S1 and S2
  (managed from the panel).
- **Rolling map rotation** — versioned structured state renders a 2-month
  window; a daily Warsaw-time scheduler catches up at calendar-month boundaries
  and auto-fills Wednesdays from Utah → SMDM → Omaha → Carentan → SME.
- **Node info** — post/edit an identical NODES embed across every channel
  listed in `NODES_CHANNELS`.
- **Healthcheck** — validates env vars, channel permissions, and faction-role
  hierarchy, with actionable hints for each issue.
- **Team Rep approval queue** — members request the role by posting in
  `TEAM_REP_CHANNEL`; the approval card (with the `TEAM_REP_PING_ROLE` ping
  and ✅/❌ buttons) is posted to `ADMIN_LOG_CHANNEL`, never to the public
  channel. The public channel shows only reactions on the request message
  (⏳ → ✅ / ❌ / ℹ️). `/teamrep add|remove` still works for manual management.
- **Clan tags** — members put their clan tag in front of their nickname with
  `/tag set` (autocompleted from the configured tag list) and drop it again
  with `/tag remove`. Admins manage the list and other members' tags with
  `/tags`. If a role named exactly like the tag exists it is granted, and any
  other tag role is removed.
- **Mid cap poll** — a native Discord poll in `MIDCAP_CHANNEL` for the next
  match's mid cap. The options are the mid caps of whatever map the rotation has
  scheduled, and the poll closes at kick-off. Who may vote is a channel
  permission, not a bot rule.
- **Per-clan signups** — a permanent category with one private signup channel
  per clan tag (visible to the guild role named like the tag) plus a public
  `#signup-solo`. For each match day a RaidHelper event is created in every
  channel via the RaidHelper API — either automatically (right after each match,
  toggleable) or on demand from the panel's **Signups** row, which also
  handles cancel and channel sync. Needs `RAIDHELPER_API_KEY` (from `/apikey`)
  and **Manage Channels**; see `.env.example` for the optional knobs
  (`RAIDHELPER_BOT_ID`, template ids, match day, lead days).
- **Audit logging** — every admin action is logged to `ADMIN_LOG_CHANNEL`;
  the panel footer shows the most recent action.

## Prerequisites

In the [Discord Developer Portal](https://discord.com/developers/applications)
for your bot application, under **Bot → Privileged Gateway Intents**, enable:

- **Server Members Intent** — required. The weekly role reset, healthcheck,
  `/teamrep` and `/tags set|clear` all fetch guild members; without this intent
  Discord rejects those calls with a cryptic "Used disallowed intents" error.

The bot also needs **Manage Nicknames** in the server (for the clan tag
commands) in addition to **Manage Roles**, and its own role must sit above
every role it hands out and above the members whose nicknames it renames.

Message Content Intent is **not** required (the bot never reads message text).

## Quick start (Docker)

```bash
git clone https://github.com/jemiel1/mwf-utils.git
cd mwf-utils
cp .env.example .env
# edit .env and fill in IDs/tokens
docker compose up -d --build
docker compose run --rm bot node deploy-commands.js   # once, and after adding/editing slash commands
```

Update after a new release:

```bash
git pull && docker compose up -d --build
```

Logs: `docker compose logs -f bot`.

## Local run (without Docker)

```bash
npm install
cp .env.example .env   # edit
npm run deploy         # register slash commands (once)
npm start
```

Stores (lineup, rotation, nodes, clan tags, last-action) persist in `./data` relative to
the bot's working directory. Set `DATA_DIR` to override this location. In the
Docker image the working directory is `/app`, so the existing `bot_data` volume
continues to persist `/app/data`.

## Environment variables

See [`.env.example`](./.env.example) for the full list. `BOT_TOKEN`,
`CLIENT_ID`, `GUILD_ID`, and faction settings are required at startup; the
remaining values enable their corresponding features.

| Variable | Description |
|---|---|
| `BOT_TOKEN` | Discord bot token |
| `CLIENT_ID` | Bot application ID |
| `GUILD_ID` | Target server (guild) ID |
| `FACTION_CHANNEL` | Where the "Choose your side!" embed is posted |
| `ALLIES_ROLE`, `AXIS_ROLE` | S1 faction role IDs |
| `ALLIES_S2_ROLE`, `AXIS_S2_ROLE` | S2 faction role IDs |
| `ADMIN_LOG_CHANNEL` | Channel for admin + faction selection logs |
| `LINEUP_CHANNEL` | Channel for lineup posts |
| `SERVER_DETAILS_CHANNEL` | Channel for server details embeds |
| `MAP_ROTATION_CHANNEL` | Channel for the map rotation embed |
| `NODES_CHANNELS` | Comma-separated list of channels for the NODES embed |
| `TEAM_REP_CHANNEL` | Channel where posting any message requests the Team Rep role (optional feature) |
| `TEAM_REP_ROLE_ID` | Role granted when a Team Rep request is approved (optional feature) |
| `TEAM_REP_PING_ROLE` | Role pinged on every new Team Rep request (optional feature) |
| `TAG_CHANNEL` | Where `/tags post` publishes the clan tag info embed (optional — defaults to the channel the command is run in) |
| `MIDCAP_CHANNEL` | Cap selection channel for the mid cap poll (optional feature — unset disables it entirely) |

Optional: `SERVER_S{1,2}_{NAME,PASSWORD}`, `RESET_DAY`, `RESET_HOUR`,
`ROTATION_EVENT_TIME`, `FACTION_SWAP_COOLDOWN_SECONDS`,
`ADMIN_DESTRUCTIVE_COOLDOWN_SECONDS`, `ALLOWED_GUILDS`,
`LINEUP_COMMAND_CHANNEL`, `DATA_DIR`, `LOG_LEVEL`.

## Slash commands

| Command | Permission | Purpose |
|---|---|---|
| `/panel` | Administrator | Open the admin control panel |
| `/lineup server:<S1\|S2> image:<file>` | Administrator | Post a lineup image |
| `/teamrep add\|remove member:<user>` | Administrator | Manually assign/remove the Team Rep role |
| `/tag set tag:<tag>` · `/tag remove` | anyone | Set/remove your own `[TAG]` nickname prefix |
| `/tags list\|add\|remove\|post\|set\|clear` | Administrator | Manage the clan tag list and other members' tags |
| `/ping` | anyone | Bot latency check |

Everything else (posting/editing server details, rotation, nodes, reloading
the faction embed, clearing logs, running the healthcheck) is done from
**`/panel`**.

## Panel actions

The panel is one ephemeral message with a status row per feature (🟢 posted,
🟡 partial, 🔴 not posted, ↗ jump to the message) plus the next auto-reset,
anything not configured, and missing env vars. It **redraws itself** after every
action that changes what it shows, and the footer names the last admin action.

A feature that has no env configured shows no row and offers no actions — it is
listed once under "Not configured" instead. So 🔴 always means "set up, but not
posted", which is exactly what **Post all missing** acts on. Refresh,
Healthcheck and Post all missing are never hidden, so a broken `.env` stays
diagnosable.

With `PANEL_V2=1` (see below) each feature row carries its own one-click
button — Faction *Reload*, Rotation *Sync*, Nodes *Post*, Mid Cap *Poll*,
Signups *Post* — and the rest are grouped into four dropdowns:

- 📋 🖥️ 📍 **Content** — Edit lineup S1/S2, Post/Edit server details S1/S2, Edit nodes
- 🗺️ **Map Rotation** — Edit, Advance (+1 month), Reset to current month, Undo
- 📅 **Signups** — Sync channels, Toggle auto-post, Cancel next match
- ⚠️ **Destructive** — Reset Roles, Clear Log Channel

plus a **Refresh · Healthcheck · Post all missing** button row. Without
`PANEL_V2` the panel renders as a classic embed with the original five
dropdowns, which between them still reach every action.

Destructive actions (Reset Roles, Clear Log Channel, Cancel signups) require
ephemeral confirmation; Reset Roles and Clear Log Channel are also rate-limited
per user.

### Panel layout (`PANEL_V2`)

`PANEL_V2=1` switches `/panel` to a Discord **Components V2** container: an
accent stripe instead of an embed, a button on each feature row, and no
five-row ceiling — which is why the per-clan signups fit on the panel itself
rather than in a second message. Unset it and the embed layout comes back; no
rebuild needed, `docker compose` reads `.env` on restart.

Two things worth knowing if you edit the panel: a Components V2 message may
carry no embeds and no `content`, and its flag has to be set on the reply *and*
every edit — [`src/panel/payload.js`](./src/panel/payload.js) is the only place
that attaches it. The container is capped at 40 components (the panel uses 35);
[`src/panel/budget.js`](./src/panel/budget.js) counts them before sending,
because discord.js does not and Discord answers an over-budget message with a
bare 400.

## Clan tags

The tag list lives in `data/tags_data.json` and feeds the autocomplete on
`/tag set`. If that file is missing it is seeded from `DEFAULT_CLAN_TAGS` in
[`src/config/constants.js`](./src/config/constants.js) — the list migrated from
the retired standalone TagSelector bot. The file always wins over that list, so
tags removed with `/tags remove` stay removed.

- Nicknames are rewritten to `[TAG] Name`. An existing `[...]` prefix is
  stripped first, so switching tags never stacks prefixes, and the name is
  truncated — never the tag — to stay inside Discord's 32-character limit.
- Removing a tag restores the plain name; if that equals the member's account
  name the per-guild nickname is cleared instead of set.
- Tag roles are matched by **role name**. Create a role named exactly like the
  tag and members get it automatically; without one, only the nickname changes.
  Roles are never created here, and a role failure never undoes the nickname
  change — the member just gets a warning.
- `/tags remove` only takes the tag out of the list. Pass `delete_role:true` to
  also delete the Discord role; members who already carry the tag keep their
  nickname until they run `/tag remove`.
- `/tags post` publishes the public info embed to `TAG_CHANNEL`, or to the
  current channel when that variable is unset.

## Mid cap poll

Set `MIDCAP_CHANNEL` to the cap selection channel. Without it the feature is
inert: no poll, no scheduler, no panel row.

It is a **native Discord poll**, so Discord does the counting and enforces one
vote per member. **Eligibility is channel permissions** — whoever you allow to
vote in that channel can vote; the bot does not check roles. The bot itself needs
View Channel, Send Messages and **Send Polls** there (the healthcheck verifies
all three).

- The question and options come from the rotation: `Mid cap — Omaha (Wed 12 Aug)`
  with that map's three mid caps from
  [`src/config/midCaps.js`](./src/config/midCaps.js) (all 20 maps, taken from the
  MIDWEEK FRONTLINE data sheet). Map names are matched ignoring case, accents and
  punctuation, so a rotation event spelled "Sainte-Mère-Église" finds `SME`.
- The poll's duration is set so it **closes at kick-off**, clamped to Discord's
  1–768 hour range.
- Polls cannot be edited after posting, only ended — so there is exactly one poll
  per match, tracked in `data/midcap_polls.json`. Posting is idempotent: the
  panel action on an existing poll leaves it alone and says so. If the poll was
  deleted, it is reposted.
- When a new match's poll goes up, the previous match's poll is ended so its
  result is final.
- The scheduler posts the poll for the next match in the post-match slot (22:05
  Warsaw by default), so the new vote is up within minutes of the match ending.
  For that tick a match that has kicked off counts as played, otherwise the
  rotation's 6-hour live window would make the finished match stand in for the
  next one. Nothing is posted on startup — restarting the bot never publishes a
  poll unasked.
- Nothing is posted once a match has started (`live`), and nothing is posted for
  a map with no mid caps configured; both are reported by the healthcheck.

## Map rotation safety

Rotation data is stored canonically in `data/rotation_state.json`; Discord is a
rendered view and a recovery fallback. Every state has a revision number, so an
old edit preview cannot overwrite a newer manual or scheduled update. Posting
uses an idempotent upsert and removes confirmed duplicate rotation messages only
after the desired message is live.

## PM2 (Windows/local)

Use the included single-instance configuration:

```bash
pm2 delete mwf-bot
pm2 start ecosystem.config.js
pm2 save
```

Do not run `npm start` at the same time as PM2.

## Scheduled jobs

Everything that follows the match schedule runs in the **post-match slot**:
`RESET_DAY` at `RESET_HOUR`:00 Warsaw time, default Wednesday 22:00 — two hours
after the 20:00 kick-off, so the match is over. `RESET_HOUR` is the single knob;
move it and every job below moves with it.

- **Weekly reset** (`:00`) — removes the Allies/Axis S1+S2 roles on `RESET_DAY`
  only.
- **Mid cap poll** (`:05`) — posts the poll for the *next* match, so the new vote
  is up minutes after the current match ends. Skipped when `MIDCAP_CHANNEL` is
  unset.
- **Per-clan signups** (`:10`) — creates next match day's RaidHelper events when
  auto-post is on. Skipped when `RAIDHELPER_API_KEY` is unset.

The reset is weekly; the poll and the signup checks run every day at their slot
because both are idempotent — on a day where nothing is missing they do nothing,
and that is what puts the poll and the events online if the bot was down during
the slot. The minute offsets keep the reset's long role-removal loop from
competing with the other two for API budget.

One job is not match-driven and keeps its own time:

- **Rotation auto-advance** — daily at 00:30 Warsaw; it tracks calendar months,
  not matches. Advances at month boundaries and catches up multiple missed months
  in one operation (maximum 24 per run), then updates Discord once.

## Development

```bash
npm run lint        # ESLint
npm run typecheck   # tsc over the @ts-check'd files (gradual typing)
npm test            # jest
```

Typing is gradual: `tsconfig.json` has `checkJs` off and individual files opt
in with a `// @ts-check` header plus JSDoc annotations. To convert another
file, add the header and fix what `npm run typecheck` reports.

Interaction routing is table-driven (`src/events/interactionCreate.js`):
adding a button/modal/select flow means adding a row to `BUTTON_ROUTES`,
`MODAL_ROUTES` or `SELECT_ROUTES` — the dispatcher, the admin gate, the
audit-log entry and the panel redraw are shared. A route carries `refresh: true`
when its handler changes something the panel shows; `admin_*` button routes must
sit **above** the `admin_` catch-all, which matches by prefix. Slash commands
dispatch by name into the command module; a command with autocompleted options
exports `autocomplete(interaction)` next to `execute`.

### The panel

`/panel` is a thin command; everything it shows and does lives in
[`src/panel/`](./src/panel/):

| File | Owns |
|---|---|
| `features.js` | which features exist and what env configures each one |
| `probes.js` | what is actually posted in Discord (reads only — no cache writes) |
| `rows.js` | the status line per feature, shared by both renderers |
| `controls.js` | every customId, as data: menus per layout, section buttons |
| `render.v1.js` / `render.v2.js` | the embed layout and the container layout |
| `payload.js` | probe → view → renderer, and the only place the V2 flag is set |
| `refresh.js` | redrawing the panel after an action |
| `budget.js` | counting components before Discord rejects them |
| `respond.js` | how an action acks and reports, so the panel stays editable |

Two rules that are easy to break silently. A panel action must ack with
`deferUpdate()` and answer with an ephemeral `followUp()` — use
`ackPanelAction` / `reportPanelResult` from `respond.js` rather than
`deferReply`/`editReply`, because after a `deferReply` the interaction's
"@original" message is the handler's own reply, so the redraw would overwrite
the admin's result. And a confirm dialog or an edit preview lives on its own
message, so it can neither redraw the panel nor `update()` it.

## License

Internal / community project; no formal license. Issues and PRs welcome.
