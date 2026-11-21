# Changelog

## v1.0.0 — Complete SettleUp Rebuild
- Built relational SQLite schema (`server/db.ts`) with 14 normalized tables, foreign keys, check constraints, and 1:1 MySQL parity (`docs/schema.mysql.sql`).
- Implemented exact integer-paise split engine (`server/math.ts`) supporting Equal, Exact, Percentage, Shares, and Item-wise splits with proportional tax/tip/discount.
- Implemented Greedy Min-Cash-Flow debt simplification and honest two-step UPI QR settlement confirmation.
- Built crisp daylight fintech UI with Three.js 3D hero sculpture, GSAP scroll choreography, interactive 5-person Tea/Coffee/Samosa landing calculator, SVG analytics charts, CSV/Print exports, interactive guided tour, and server-side Gemini AI Help Assistant.
- Added automated unit test suite (`tests/financial.test.ts`) and full CSE academic & viva documentation (`/docs/`).

## v1.1.0 — Safety, CSV, Trip Ledger & Guest Access
- Standardised all CSV exports to `DD-MM-YYYY`, UTF-8 BOM, CRLF and spreadsheet formula-safe text; added newest-first / oldest-first export choice for shared expenses and Trip Ledger.
- Standardised server date-only defaults and analytics windows using `APP_TIME_ZONE` (defaults to `Asia/Kolkata`).
- Improved the shared-expense form's empty group selection, quantity editing and zero-value tax/tip/discount focus behaviour.
- Added itemised Trip Ledger with two default participants, editable/additional participants, item-level consumers, separate bill payers, integer-paise allocation, balances, charts, settlements, editing/deleting and detailed CSV export.
- Added scoped, expiring HTTP-only guest sessions for read-only group invitation access; guests can view expenses, balances, category analytics and settlement history without registration.
- Enabled registered group members to edit group expenses while retaining creator/admin-only deletion; added payer and participant membership validation on edits.
- Reused active pending email/phone invitations instead of failing with duplicate-invitation errors.
- Removed browser-stored session tokens, secured password recovery through configured email links, invalidated other sessions on password change/reset, added production configuration checks and basic security headers.
- Added SQLite database-path safety checks, schema migration version records, an online SQLite backup script and tests for CSV, date, Trip Ledger maths and database safety.
- Updated Help Centre, privacy wording, README and verification report. Full build, live API and browser tests remain pending because dependencies and the main saved database are not present in the supplied archive.
