# SettleUp — Collaborative Group Expense & Settlement Platform

SettleUp is a full-stack group expense management web application featuring **item-wise bill splitting in integer paise**, **Trip Ledger for independent trips**, **read-only guest access through scoped invitation sessions**, **group debt simplification**, **two-step UPI payment QR settlement confirmation**, **SQL-driven analytics and CSV reports**, and a **server-side Gemini AI help assistant**.

## Key Features
- **Five Splitting Modes**: Equal, Exact ₹, Percentage %, Shares, and **Item-Wise** (with proportional GST/tax, tip, and discount distribution).
- **Zero Floating-Point Drift**: All monetary calculations run in integer paise (`100 paise = ₹1 INR`) using Hamilton Largest-Remainder allocation.
- **Debt Simplification**: Minimizes transfers across group members (`≤ N − 1` payments) without altering historical expenses.
- **Trip Ledger**: Create an independent trip with two default participants, add people later, allocate each bill item to its actual consumers, record different payers, and track settlements. No invitations or participant accounts are required.
- **Group Invitations**: Expiring email, QR, SMS and WhatsApp share links. SMTP is required for actual email delivery and Twilio for automated SMS; WhatsApp opens a prefilled message for the user to send.
- **Read-only Guest View**: Valid invitation links can create a short-lived HTTP-only guest session scoped to one group. Guests can view group expenses, balances, analytics and settlement history but cannot make changes.
- **CSV Safety**: All CSV exports use `DD-MM-YYYY` dates, UTF-8 BOM, formula-injection protection and consistent line endings.
- **Honest UPI QR Workflow**: Generates standard `upi://pay?...` QR codes and separates `recorded` payments from `confirmed` receipts.
- **Security**: Salted `scrypt` password hashing, HTTP-only session cookies, short-lived guest sessions, CSRF origin verification, rate limiting, and group membership permission checks. Registered group members can edit group expenses; deletion remains restricted to the creator or an admin.
- **Visual Identity**: Crisp daylight editorial UI, Three.js 3D geometric hero sculpture, GSAP choreography, and SVG analytics charts.

## Running Locally (Windows or macOS/Linux)
1. Install **Node.js 22 LTS or newer** from https://nodejs.org/.
2. Extract the ZIP into a writable folder. On Windows, you can double-click `setup-windows.bat` for first-time setup.
3. Alternatively, run `npm install` to download dependencies, then copy `.env.example` to `.env`.
4. Run `npm run db:init` once. It creates the main `settleup.db` using the current schema and never overwrites an existing database. A new database starts empty; it does not recover old data from WAL/SHM files alone.
5. Run `npm run dev` and open `http://localhost:3000`.

`npm install` creates the computer-specific `node_modules` folder and `package-lock.json` on the machine where you install the project. Do not copy `node_modules` from another computer, because the SQLite native module must match that computer's operating system and Node.js version.

## Database safety
- The default main database is `./settleup.db`. Set `DB_PATH` in `.env` to a stable persistent path if needed.
- `npm run db:init` creates a database only when missing; it will not replace an existing file.
- Normal production startup refuses to silently create a new empty database when the configured file is missing. Initialize it explicitly first.
- Use `npm run backup:db` for a consistent SQLite online backup. Do not copy only the `.db-wal` or `.db-shm` files.
- `SEED_DEMO_DATA` defaults to `false`. Set it to `true` before first initialization only if you intentionally want sample/demo users and data. Do not enable demo data on a live production installation.

## Email and SMS configuration
The HTML email templates for group invitations and password resets are already included in `server/mailer.ts`; no separate HTML file is needed. Configure SMTP in `.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) to send real email. Configure Twilio (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`) for automated SMS. WhatsApp remains a user-initiated share link. Keep all provider secrets in your private `.env` file or hosting secret settings; never add `.env` to the ZIP or share it in chat.

For production, also set a random `SESSION_SECRET` (at least 32 characters), a public HTTPS origin-only `APP_URL`, and persistent disk storage for `DB_PATH`. `GEMINI_API_KEY` is optional for the AI Help Assistant.

## Testing on a Phone

- For same-Wi-Fi testing, start SettleUp on the computer and open the computer's LAN IPv4 address with port `3000` on the phone (for example, `http://192.168.x.x:3000`). Do not use `localhost` on the phone; that points back to the phone itself.
- Allow the app through the computer's firewall on the private network if prompted.
- For access from outside the local Wi-Fi, deploy the frontend and API behind a public HTTPS domain, set `APP_URL` to that domain, and use persistent storage for `DB_PATH`. A LAN address is not a public deployment URL.

## Optional Demo Data
Demo credentials and sample transactions are not created by default. To intentionally seed sample content, set `SEED_DEMO_DATA=true` in `.env` before initializing a brand-new database. The demo account is `aarav@settleup.app` with password `Demo@1234`. Do not enable demo seeding on a live production installation.

## Academic Documentation
- `/docs/ACADEMIC_REPORT.md` — Abstract, SRS, ER/DFD/Sequence diagrams, Pseudocode, API reference
- `/docs/VTU_SUBJECT_MAPPING_AND_VIVA.md` — 1st–5th semester CSE subject mapping, slide outline, and Viva Q&A
- `/docs/schema.mysql.sql` — MySQL 8.0 academic reference DDL for core groups, guest sessions and Trip Ledger tables (the live SQLite schema remains authoritative)
- `/LEARNING_NOTES.md` — Beginner-friendly module-by-module code guide
