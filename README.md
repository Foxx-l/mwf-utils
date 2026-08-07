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
- **Rolling map rotation** — embed shows a 2-month window; a daily scheduler
  auto-advances months as they pass, auto-filling Wednesdays from a fixed
  cycle (Utah → SMDM → Omaha → Carentan → SME).
- **Node info** — post/edit an identical NODES embed across every channel
  listed in `NODES_CHANNELS`.
- **Healthcheck** — validates env vars, channel permissions, and faction-role
  hierarchy, with actionable hints for each issue.
- **Audit logging** — every admin action is logged to `ADMIN_LOG_CHANNEL`;
  the panel footer shows the most recent action.

## Requirements

- Docker with Docker Compose, or Node.js 20+
- A Discord application and bot token
- Bot permissions: View Channels, Send Messages, Embed Links, Attach Files,
  Read Message History, Manage Messages, Manage Roles, and Manage Expressions

## Quick start (Docker)

```bash
git clone https://github.com/jemiel1/mwf-utils.git
cd mwf-utils
cp .env.example .env
# edit .env and fill in IDs/tokens
docker compose up -d --build
docker compose run --rm bot node deploy-commands.js   # once, and after changing slash commands
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

Runtime state (lineups, rotation, nodes, and the latest admin action) is stored
in `/app/data`. Docker Compose persists it in the `bot_data` volume. For a
non-Docker run, create a writable `/app/data` directory or change the store
paths in `src/utils/*Store.js`.

## Environment variables

See [`.env.example`](./.env.example) for the full list. Required:

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

Optional: `SERVER_S{1,2}_{NAME,PASSWORD}`, legacy `SERVER_{NAME,PASSWORD}`,
`RESET_DAY`, `RESET_HOUR`, `FACTION_SWAP_COOLDOWN_SECONDS`,
`FACTION_SWAP_CONCURRENCY`, `ADMIN_DESTRUCTIVE_COOLDOWN_SECONDS`,
`ALLOWED_GUILDS`, `LINEUP_COMMAND_CHANNEL`, and `LOG_LEVEL`.

## Slash commands

| Command | Permission | Purpose |
|---|---|---|
| `/panel` | Administrator | Open the admin control panel |
| `/lineup server:<S1\|S2> image:<file>` | Administrator | Post a lineup image |
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

## Scheduled jobs

- **Weekly reset** — removes Allies/Axis S1+S2 roles every `RESET_DAY` at
  `RESET_HOUR`:00 Warsaw time (default Wednesday 22:00).
- **Rotation auto-advance** — daily at 00:30 Warsaw; when the first month of
  the rotation embed is entirely in the past, shifts the window forward one
  month and auto-fills new Wednesdays from the map cycle.

## Contributing

Issues and pull requests are welcome. Run a syntax check before submitting:

```bash
find src -name '*.js' -exec node --check {} \;
node --check deploy-commands.js
```

## License

No license has been published. Unless a license is added, the repository is
source-available for review but retains the author's default copyright.
