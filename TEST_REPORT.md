# SettleUp — Verification & Test Report

**Environment**: Node.js `v22.23.2`, TypeScript, Express `4.21.2`, SQLite (`better-sqlite3`), Vite `8.3.0`  
**Test Execution Date**: 2026-11-15

---

## 1. Automated Unit Tests (`npm test`)

Command: `tsx --test tests/financial.test.ts`  
Result: **7 / 7 tests passed (0 failed, 0 skipped)**

| # | Test Case | Expected Invariant | Status |
|---|---|---|---|
| 1 | Five-person Tea, Coffee & Samosas item-wise split | Tea ₹100 (4 consumers) + Coffee ₹120 (1) + Samosas ₹150 (5) = ₹370 total (`5500, 5500, 5500, 5500, 15000` paise) | Pass |
| 2 | Itemized split with proportional tax, tip, and discount | Charges allocated proportionally to item subtotals with zero paise loss (`33000` paise total) | Pass |
| 3 | Equal split for indivisible amounts (`₹100 ÷ 3`) | Deterministic Hamilton Largest-Remainder allocation (`[3334, 3333, 3333]` paise, sum `= 10000`) | Pass |
| 4 | Exact split mismatch validation | Throws when participant exact sums do not equal bill total; accepts exact sums | Pass |
| 5 | Percentage and Shares splits | `60%/40%` of ₹1,000 = `60000/40000`; `2:1` shares of ₹900 = `60000/30000` | Pass |
| 6 | Greedy debt simplification (`simplifyDebts`) | Reduces 5-member net balances to 4 minimal transfers summing to `31500` paise | Pass |
| 7 | `scrypt` salted password hashing (`hashPassword` / `verifyPassword`) | Accepts matching password and rejects wrong password via timing-safe comparison | Pass |

---

## 2. Live Full-Stack API & Database Integration Verification

Executed against the live Express + Vite server on `http://localhost:3000`:

| Check | Endpoint / Flow | Observed Result | Status |
|---|---|---|---|
| Health Check | `GET /api/health` | `200 OK` (`{ status: 'ok', service: 'SettleUp API' }`) | Pass |
| Demo Login & Cookie | `POST /api/auth/demo` | `200 OK`, `aarav@settleup.app`, HTTP-only `settleup_sid` cookie issued | Pass |
| Seeded Financial Data | `GET /api/balances/overview`, `/api/groups`, `/api/expenses`, `/api/analytics/summary` | `3` seeded groups, `6` seeded expenses, net balance `-55500` paise (`-₹555.00`), category & group SQL aggregations returned | Pass |
| CSV Report Export | `GET /api/analytics/export.csv` | `200 OK`, valid CSV payload with `Expense ID` header | Pass |
| UPI Payment QR | `POST /api/balances/upi-qr` | `200 OK`, `upi://pay?...` URI and PNG `data:image/png;base64,...` QR generated | Pass |
| Server-Side AI Help Assistant | `POST /api/assistant` | `200 OK`, Gemini response returned (`source: gemini`) | Pass |
| Fresh User Empty State | `POST /api/auth/register` -> `GET /api/balances/overview`, `/api/groups` | `201 Created`, new user starts with `netBalancePaise: 0` and `0` groups | Pass |
| Group RBAC Guard | `GET /api/groups/1` as non-member | `403 Forbidden` access denied | Pass |
| Itemized Expense Persistence | `POST /api/expenses` (`splitMethod: 'itemized'`) | `201 Created`, `totalPaise: 22000` saved in SQLite | Pass |
| Two-Step Settlement Flow | `POST /api/balances/settlements` -> `POST /api/balances/settlements/:id/confirm` | Starts as `recorded` (balance remains `17000` paise); becomes `confirmed` on receiver confirmation and clears group transfer to `0` | Pass |
| Group Deletion Cleanup | `DELETE /api/groups/:id` after settling | `200 OK` once all member balances are zero | Pass |

---

## 3. Build, Type-Check & Production Startup Verification

- `npm run lint` (`tsc --noEmit`): **0 errors**
- `npm run build` (`vite build`): **Succeeded** (production bundle emitted to `dist/`)
- `NODE_ENV=production node server.ts` (Node.js `v22.23.2` native TypeScript execution on alternate check port `3099`):
  - `GET /api/health` -> `200 OK` (`{"status":"ok","service":"SettleUp API"}`)
  - `GET /` -> `200 OK` serving built SPA `dist/index.html`

---

## 4. Known Scope & Verification Notes

- Browser DOM interaction was not separately driven with a headless browser runner in this verification pass; client TypeScript types, Vite bundling, and all backend endpoints + SQLite transactions were verified directly.
- A relational MySQL 8.0 DDL parity export is provided in `/docs/schema.mysql.sql`, while live execution uses embedded SQLite (`better-sqlite3`) for zero-setup portability on port 3000.
