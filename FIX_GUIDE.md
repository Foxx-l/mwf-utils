# Apply the complete MWF Utils fix set on Windows/PM2

## What this fix set changes

- Uses a Windows-safe local `data` directory and creates it automatically.
- Logs persistence failures instead of hiding them.
- Prevents duplicate Nodes posts from **Post All Missing**.
- Recovers missing Lineup and Server Details cache records from Discord.
- Fixes the Map Rotation modal double-acknowledgement path.
- Validates rotation calendar dates and Discord field lengths.
- Uses Europe/Warsaw for rotation month boundaries.
- Allows empty past rotation months to advance.
- Implements Team Rep cooldown and concurrent-request protection.
- Retries only transient Team Rep assignment errors.
- Restores old faction roles if adding the new faction fails.
- Extends Healthcheck to the optional Team Rep channel and role.
- Clears old log messages individually when Discord bulk deletion cannot.
- Upgrades `node-cron` and removes the reported dependency vulnerabilities.
- Adds a working lint command and rotation tests.

## Install the fixed project

1. Stop the bot:

```powershell
pm2 stop mwf-bot
```

2. Back up your current `.env` file:

```powershell
cd C:\Users\jemie\mwf-utils
Copy-Item .env ..\mwf-utils.env.backup
```

3. Download and extract `mwf-utils-fixed.zip`.

4. Copy the extracted files over `C:\Users\jemie\mwf-utils`. Do not delete or overwrite your existing `.env` file. The ZIP does not contain a `.env`.

5. Restore the backup only if your `.env` was accidentally removed:

```powershell
Copy-Item ..\mwf-utils.env.backup .env
```

6. Install the updated dependencies:

```powershell
npm install
```

7. Verify everything:

```powershell
npm test
npm run lint
npm audit
```

Expected results:

- 2 test suites pass;
- 9 tests pass;
- lint exits without errors;
- npm reports 0 vulnerabilities.

8. Restart the one PM2 instance:

```powershell
pm2 restart mwf-bot --update-env
pm2 save
pm2 logs mwf-bot --lines 100
```

Do not also run `npm start`, because that would create a second bot instance.

## Optional data location

By default, persistent files are saved in:

```text
C:\Users\jemie\mwf-utils\data
```

You may override it in `.env`:

```dotenv
DATA_DIR=C:\Users\jemie\mwf-utils\data
```

No slash-command redeployment is required for this fix set.
