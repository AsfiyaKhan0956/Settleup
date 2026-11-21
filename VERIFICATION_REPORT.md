# SettleUp package verification report
Date: 2026-11-20

## Verified
- ZIP source archive passed `zipfile.testzip()` before packaging.
- Main SQLite database `settleup.db` is included.
- SQLite `PRAGMA integrity_check` returned `ok`.
- Database contains 31 tables, including the Trip Ledger tables.
- Database currently contains zero users; it is a fresh, empty starting database.
- Required setup files are present: `setup-windows.bat`, `.env.example`,
  `scripts/init-db.ts`, and `scripts/backup-db.ts`.
- Required Trip Ledger, CSV, and date utility source files are present.
- Original uploaded archive and its orphaned WAL/SHM sidecars are retained separately
  in `recovery/`; they are not used as the new database.

## Not verified in this environment
- `npm install` did not finish within the available 120-second window.
  No dependency installation or `node_modules` folder is included.
- The automated test suite could not run because `tsx` is not installed.
- TypeScript type-check, Vite production build, and live browser/API testing
  were not completed.
- Email and automated SMS delivery are not configured; provider credentials
  and (for production email) a verified sending domain are still required.

## First run on Windows
1. Install Node.js 22 or newer.
2. Extract this ZIP into a normal writable folder.
3. Double-click `setup-windows.bat`.
4. The script runs `npm install`, initializes the database only if absent,
   then starts the development server.
5. Keep `.env` private. Do not share it or publish its secrets.

This report distinguishes package/database integrity checks from application
build and runtime tests. It does not claim the latter have passed.
