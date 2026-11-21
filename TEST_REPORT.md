# SettleUp — Verification & Test Report

**Verification date:** 2026-11-20  
**Available runtime:** Node.js `v22.16.0`, Python SQLite 3  
**Project dependencies:** Not installed in this working environment (`node_modules` is absent)

## 1. Automated tests actually executed

Command:

```bash
node --experimental-strip-types --test tests/financial.test.ts tests/trip-ledger.test.ts tests/csv-date.test.ts tests/db-safety.test.ts
```

**25 passed · 0 failed**

The 25 passing tests cover:

- Existing expense split calculations, proportional charges and debt simplification
- Password hashing and phone validation
- Honest SMTP/Twilio “not configured” responses
- CSV date formatting, UTF-8 BOM, CRLF and spreadsheet formula protection
- Application timezone and calendar-date arithmetic
- Trip Ledger item allocation, paise remainder distribution and simplified transfers
- Refusing to create a new database when only SQLite WAL/SHM sidecars exist
- Requiring an existing persistent database path in production

## 2. Database/schema checks

- Executed the complete `CREATE TABLE` / `CREATE INDEX` SQL from `server/db.ts` against an in-memory Python SQLite database: passed.
- Verified the new Trip Ledger tables, item-consumer allocations, shares and cascade cleanup: passed.
- Verified the guest-session lookup is scoped to its invitation, checks expiry and stops working after invitation revocation: passed.
- Verified the main Trip Ledger list, expense, item-consumer and settlement SQL queries against an in-memory SQLite schema: passed.

These are isolated SQLite checks, not tests against the user's saved database or a running `better-sqlite3` server.

## 3. Source syntax checks

TypeScript's `transpileModule` parser checked 59 `.ts` / `.tsx` files in `server`, `src`, `tests` and `scripts`: **0 syntax errors**.

This is a syntax check, not a full TypeScript semantic type-check.

## 4. Checks not run

The following have **not** been verified in this environment:

- `npm run lint` / `tsc --noEmit`: blocked because `node_modules` is absent and `vite/client` type definitions cannot be found.
- `npm run build`: not run because Vite dependencies are absent.
- Live Express API integration, browser interaction, responsive-device testing and end-to-end guest invitation flows.
- Real SMTP email delivery or Twilio SMS delivery; provider credentials are not configured here.
- The SQLite online-backup script against a real database; `better-sqlite3` is not installed in this environment.
- Production startup and deployment.

## 5. Database preservation warning

The supplied project archive contains `settleup.db-wal` and `settleup.db-shm` sidecar files but no main `settleup.db` file. Those sidecars alone have not been shown to recover the saved database. The project now refuses to silently create a new empty database when it detects orphaned sidecars, and production requires an existing persistent database file. Do not treat the original saved data as recovered until the main database is located and verified.

## 6. Configuration still required for deployment

Production requires:

- `DB_PATH` pointing to an existing persistent SQLite database file
- A random `SESSION_SECRET` of at least 32 characters
- A public HTTPS `APP_URL`
- SMTP credentials for real invitation and password-reset email delivery
- Twilio credentials for automated SMS delivery, if required

WhatsApp sharing currently opens a prefilled WhatsApp message for the user to send; it is not automated WhatsApp Business API delivery.
