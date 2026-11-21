# SettleUp Project Status

## Completed Modules
- [x] Public Landing Page with Three.js 3D hero sculpture & interactive Tea/Coffee/Samosa demo
- [x] Authentication (Register with avatar & strength meter, Login, Demo Login, Forgot/Reset Password, Change Password, Safe Delete)
- [x] Public Help Centre, Privacy Policy, Terms & Conditions, 403 / 404 / Session Expired pages
- [x] Dashboard Overview with animated KPI counters, SQL charts, recent transactions, and new-user empty state
- [x] My Groups & Dedicated Group Workspace (Overview, Expenses, Members & QR Invites, Balances, Activity, Settings)
- [x] Add & Edit Expense Builder (Equal, Exact, Percentage, Shares, Item-wise with tax/tip/discount & receipt upload)
- [x] Expense History & Detailed Audit Modal (Search, filter, sort, edit, confirmed delete)
- [x] Balances (Who Owes Whom, simplified transfers, calculation formula trace)
- [x] Settlements & UPI Payment QR Workflow (`pending` -> `recorded` -> `confirmed`)
- [x] Analytics & Reports (Monthly/Weekly/Category/Group/Member charts, CSV export, Print/PDF mode)
- [x] Notifications & Activity Feed + Profile & Settings
- [x] Interactive Guided Onboarding Tour + Floating Server-Side Gemini AI Help Assistant
- [x] Academic Package (`/docs/schema.mysql.sql`, `/docs/ACADEMIC_REPORT.md`, `/docs/VTU_SUBJECT_MAPPING_AND_VIVA.md`, `LEARNING_NOTES.md`)

## Current Improvement Pass — 2026-11-20
- [x] CSV date display standardised to `DD-MM-YYYY` for all current exports, with UTF-8 BOM, CRLF and formula-injection protection.
- [x] Shared-expense and Trip Ledger CSV exports support newest-first / oldest-first ordering.
- [x] Server date defaults and analytics windows use `APP_TIME_ZONE` (default `Asia/Kolkata`).
- [x] New shared-expense form starts with no automatically selected group; edit mode keeps saved values. Quantity and zero-value fields support clean editing.
- [x] Replaced the Large Trips / Manual Balance screen with the new independent itemised Trip Ledger. Legacy manual-balance tables are retained and not auto-converted.
- [x] Added read-only guest group view with scoped, expiring HTTP-only guest sessions; guests do not receive group write permissions.
- [x] Registered group members can edit shared expenses; deletion remains creator/admin-only. Expense edits now validate payer and participant group membership.
- [x] Active pending email/phone invitations are reused and re-sent rather than failing with a duplicate-pending error.
- [x] Browser-stored bearer tokens removed; legacy local/session storage tokens are cleared. Password reset now uses configured email links and does not return reset tokens to the browser.
- [x] Added production DB path checks, orphaned WAL/SHM protection, schema version records, SQLite online-backup script and baseline security headers.
- [x] Added explicit first-run database initialization (`npm run db:init`), a clean main `settleup.db`, a Windows setup script, and a setup guide. Orphaned WAL/SHM files are preserved separately under `recovery/` and are not mistaken for the main database.
- [x] Added SMTP/Twilio setup instructions; the HTML email templates are already embedded in the server mailer. Secrets remain outside the ZIP in the user's private `.env` file.
- [x] Updated Help Centre, privacy wording, README, academic schema reference, changelog and test report.

## Verification Status
- [x] 25 automated tests passed using Node's native TypeScript stripping test runner.
- [x] 59 TypeScript files passed syntax parsing with zero syntax errors.
- [x] SQLite schema and selected Trip Ledger / guest-session queries passed isolated in-memory SQLite checks.
- [ ] Full TypeScript semantic check and Vite production build — pending dependency installation (`node_modules` is absent in the supplied archive).
- [ ] Live API/browser/mobile end-to-end tests — pending a runnable environment.
- [ ] Real SMTP/Twilio delivery and public deployment — pending provider credentials and hosting configuration.
- [x] A clean new main `settleup.db` is included for first-run setup. It starts empty and does not recover the previous missing database or its saved user data.
