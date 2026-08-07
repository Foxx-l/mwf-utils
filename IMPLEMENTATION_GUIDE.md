# MWF Utils v2.1.0 — Production-safe rotation upgrade

This guide installs the complete upgrade on Windows with PM2.

## Included changes

### Map Rotation

- Canonical, versioned state in `data/rotation_state.json`.
- Discord embeds are rendered output, not the primary database.
- Automatic migration/recovery from the current live rotation embed.
- Calendar-month rollover in `Europe/Warsaw`.
- One-run catch-up after downtime, capped at 24 months.
- Persisted `nextMapIndex`; the map sequence no longer depends only on parsing the final embed line.
- In-process lock preventing scheduled/manual/post/edit operations from overlapping.
- Revision conflict checks preventing an old editor or preview from overwriting newer data.
- Strict validation for real dates, month membership, ascending order, duplicate dates, consecutive headers, map-name length, and Discord field limits.
- Idempotent upsert: edit an existing rotation, post only when missing, and remove duplicates only after a valid message is live.
- Safe post behavior: an existing rotation is preserved rather than deleted before a replacement succeeds.

### Other logic

- Centralized embed colors in `src/config/theme.js`.
- Single-instance PM2 configuration in `ecosystem.config.js`.
- Windows-safe persistent `data` directory with visible write errors.
- Team Rep cooldown/concurrency and corrected retries.
- Faction-role rollback after failed switches.
- Partial Nodes posting without duplicates.
- Cache recovery for Lineup and Server Details.
- Expanded healthcheck and log deletion.
- Updated dependencies, zero known npm vulnerabilities, linting, and 15 tests.

## Before installing

The archive intentionally contains no `.env` and no `data` folder. Back up both from your current installation.

## Installation

### 1. Stop and remove the current PM2 process

```powershell
pm2 stop mwf-bot
pm2 delete mwf-bot
```

### 2. Back up configuration and persistent data

```powershell
Set-Location C:\Users\jemie
Copy-Item .\mwf-utils\.env .\mwf-utils.env.backup -Force

if (Test-Path .\mwf-utils\data) {
    Copy-Item .\mwf-utils\data .\mwf-utils-data-backup -Recurse -Force
}
```

### 3. Keep a complete rollback copy

Run this from `C:\Users\jemie`, not from inside the project:

```powershell
if (Test-Path .\mwf-utils-old) {
    Remove-Item .\mwf-utils-old -Recurse -Force
}
Rename-Item .\mwf-utils mwf-utils-old
```

### 4. Extract the new archive

Assuming the ZIP is in Downloads:

```powershell
New-Item -ItemType Directory -Path .\mwf-utils -Force | Out-Null
Expand-Archive "$HOME\Downloads\mwf-utils-production-safe.zip" -DestinationPath .\mwf-utils -Force
```

If your browser saved it elsewhere, adjust the ZIP path.

### 5. Restore `.env` and existing data

```powershell
Copy-Item .\mwf-utils.env.backup .\mwf-utils\.env -Force

if (Test-Path .\mwf-utils-data-backup) {
    New-Item -ItemType Directory -Path .\mwf-utils\data -Force | Out-Null
    Copy-Item .\mwf-utils-data-backup\* .\mwf-utils\data -Recurse -Force
}
```

It is safe if no previous `data` directory existed. On startup, the bot can recover rotation state from the live Discord embed.

### 6. Install and verify

```powershell
Set-Location C:\Users\jemie\mwf-utils
npm install
npm test
npm run lint
npm audit
```

Expected:

- 2 test suites passed;
- 15 tests passed;
- no lint errors;
- 0 vulnerabilities.

### 7. Start exactly one PM2 instance

```powershell
pm2 start ecosystem.config.js
pm2 save
pm2 list
pm2 logs mwf-bot --lines 100
```

Press `Ctrl+C` to leave the logs. PM2 keeps the bot online.

Do **not** also run `npm start`.

## First startup and migration

At startup, the bot does the following:

1. Loads `data/rotation_state.json` when available.
2. Otherwise finds the current Map Rotation message in Discord.
3. Converts its two fields into canonical structured state.
4. Saves the state locally with revision 1.
5. Continues using the same Discord message.

No slash-command deployment is required because command definitions did not change.

## How the new rotation works

- The first displayed month should match the current Warsaw calendar month.
- At 00:30 Warsaw each day, the scheduler checks whether it is behind.
- If the bot missed multiple month boundaries, it advances all missed months in memory and edits Discord once.
- A maximum of 24 months can be advanced automatically in one run. Older/corrupt state requires manual review.
- Manual **Advance Rotation** always advances exactly one month.
- **Post Map Rotation** is now an upsert: it reuses the existing state/message and does not reset valid data.
- Every successful edit or advance increments the revision.
- If two admins edit simultaneously, the first successful Apply wins; the stale preview is rejected.

## Rotation editor rules

Use:

```text
DD/MM/YYYY - Map Name
```

Example:

```text
05/08/2026 - Utah
12/08/2026 - SMDM
19/08/2026 - Omaha
```

The editor rejects:

- impossible dates such as `31/02/2026`;
- dates outside the field's displayed month;
- duplicate dates;
- dates in descending order;
- month headers that are not consecutive;
- map names over 80 characters;
- output exceeding Discord's 1,024-character field limit.

Custom map names are allowed. The fixed cycle continues from the most recent recognized cycle map.

## Recommended checks after installation

1. Run `/panel` and select **Healthcheck**.
2. Open **Edit Map Rotation**, then Cancel, to confirm migration and modal behavior.
3. Open two Edit Rotation windows; apply one, then apply the other. The second should report a revision conflict.
4. Select **Post Map Rotation** twice. There should still be only one live rotation message.
5. Restart PM2 and confirm the same revision and message remain.

## Rollback

```powershell
pm2 delete mwf-bot
Set-Location C:\Users\jemie
Remove-Item .\mwf-utils -Recurse -Force
Rename-Item .\mwf-utils-old mwf-utils
Set-Location .\mwf-utils
npm install
pm2 start src\index.js --name mwf-bot
pm2 save
```

The upgrade keeps legacy rotation cache files populated, making rollback safer.
