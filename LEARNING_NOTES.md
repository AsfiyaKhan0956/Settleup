# SettleUp Beginner Learning Notes — How Every File Works

This guide explains every core module in plain, beginner-friendly English so you can confidently present and defend the codebase.

## 1. `server/math.ts` — The Financial Brain
- **Why it exists**: Keeping all money calculations in one pure TypeScript file guarantees both the backend API and our automated tests share identical logic.
- **What it receives**: Split method (`equal`, `exact`, `percentage`, `shares`, or `itemized`), total paise, participants, and optional bill items/tax/tip/discount.
- **What it produces**: A verified breakdown where `sum(splits.owedPaise) === totalPaise` ALWAYS, plus `simplifyDebts()` which converts net balances into minimal transfers.
- **What happens if removed**: Expenses could lose ₹0.01 due to decimal rounding, or friends would have to make unnecessary back-and-forth payments.

## 2. `server/db.ts` — Normalized Relational Database
- **Why it exists**: Initializes the relational schema (including guest-session and itemised Trip Ledger tables) with `PRAGMA foreign_keys = ON` and `CHECK` constraints, and seeds the demo cohort (`aarav@settleup.app`) so evaluators see real data immediately while new sign-ups start clean.
- **Important line**: `db.pragma('foreign_keys = ON')` — without this in SQLite, deleting a parent group or expense wouldn't enforce referential integrity.

## 3. `server/security.ts` & `server/middleware.ts` — Security & Access Control
- **Password Hashing**: Uses Node's `crypto.scryptSync` with a unique random 16-byte salt per user and `timingSafeEqual` to prevent timing attacks.
- **RBAC Guard**: `getMembership(groupId, userId)` ensures nobody can read, edit, or settle expenses in a group they haven't joined.

## 4. `server/routes/*` — RESTful API Endpoints
- `auth.ts`: Registration, login, session cookies, password resets, account deletion.
- `groups.ts`: Group CRUD, member role checks, safeguarded member removal (`netPaise === 0`), QR invitations.
- `expenses.ts`: Transactional creation/editing of expenses across 4 tables atomically.
- `balances.ts`: Real-time net balance computation, `upi://pay` QR generation, and two-step settlement confirmation.
- `analytics.ts`: SQL `SUM` / `GROUP BY` aggregations and CSV report generation.
- `assistant.ts`: Server-side `@google/genai` (`gemini-4-hydrogen`) help proxy with offline fallback.

## 5. `src/components/*` — Modular React Frontend
- `HeroVaultScene.tsx`: Uses Three.js (`RoomEnvironment`, `WebGLRenderer`, software-WebGL pacing) to render the interactive 3D ledger & coins sculpture.
- `AddExpenseView.tsx` & `src/utils/currency.ts`: Mirrors the server's integer-paise calculation live as you type, preventing invalid saves before submitting.
- `SettlementsView.tsx`: Renders the UPI QR modal and separates `recorded` from `confirmed` payments.
