# MWF Faction Bot

Discord bot for **Midweek Frontline** — faction selection, lineups, server
details, map rotation, and node info, all driven from a single admin panel.

## Features

- **Faction selection** — persistent embed with Allies/Axis buttons for S1 and
  S2, with a per-user cooldown to prevent role-swap spam.
- **Weekly auto-reset** — clears all faction roles every Wednesday at
  22:00 Europe/Warsaw (configurable).
- **`/panel` admin control** — per-feature dropdowns for Faction, Lineup,
  Server Details, Map Rotation & Nodes, and Panel utilities.
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
  `TEAM_REP_CHANNEL`; `TEAM_REP_PING_ROLE` gets pinged and admins approve or
  reject with ✅/❌ buttons on the request (no more auto-assign). `/teamrep
  add|remove` still works for manual management.
- **Audit logging** — every admin action is logged to `ADMIN_LOG_CHANNEL`;
  the panel footer shows the most recent action.

## Prerequisites

In the [Discord Developer Portal](https://discord.com/developers/applications)
for your bot application, under **Bot → Privileged Gateway Intents**, enable:

- **Server Members Intent** — required. The weekly role reset, healthcheck,
  and `/teamrep` all fetch guild members; without this intent Discord rejects
  those calls with a cryptic "Used disallowed intents" error.

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

Stores (lineup, rotation, nodes, last-action) persist in `./data` relative to
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
| `/ping` | anyone | Bot latency check |

Everything else (posting/editing server details, rotation, nodes, reloading
the faction embed, clearing logs, running the healthcheck) is done from
**`/panel`**.

## Panel actions

The panel shows one status row per feature (🟢 posted, 🟡 partial, 🔴 not
posted, ↗ jump link) and five dropdowns:

- 🛡️ **Faction Embed** — Reload, Reset Roles
- 📋 **Lineup** — Edit caption S1/S2
- 🖥️ **Server Details** — Post/Edit S1/S2
- 🗺️ 📍 **Map Rotation & Nodes** — Post/Edit Rotation, Advance (+1 month),
  Post/Edit Nodes
- 🛠️ **Panel** — Refresh Status, Post All Missing, Healthcheck, Clear Log Channel

Destructive actions (Reset Roles, Clear Log Channel) require ephemeral
confirmation and are rate-limited per user.

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

- **Weekly reset** — removes Allies/Axis S1+S2 roles every `RESET_DAY` at
  `RESET_HOUR`:00 Warsaw time (default Wednesday 22:00).
- **Rotation auto-advance** — daily at 00:30 Warsaw; advances at calendar-month
  boundaries and catches up multiple missed months in one operation (maximum
  24 per run), then updates Discord once.

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
`MODAL_ROUTES` or `SELECT_ROUTES` — the dispatcher, the admin gate and the
audit-log wrapping are shared.

## License

Internal / community project; no formal license. Issues and PRs welcome.
