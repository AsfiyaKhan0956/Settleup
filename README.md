# SettleUp — Collaborative Group Expense & Settlement Platform

SettleUp is a full-stack group expense management web application featuring **item-wise bill splitting in integer paise**, **greedy graph-based debt simplification**, **QR group invitations**, **two-step UPI payment QR settlement confirmation**, **SQL-driven analytics & CSV/PDF reports**, **interactive onboarding**, and a **server-side Gemini AI help assistant**.

## Key Features
- **Five Splitting Modes**: Equal, Exact ₹, Percentage %, Shares, and **Item-Wise** (with proportional GST/tax, tip, and discount distribution).
- **Zero Floating-Point Drift**: All monetary calculations run in integer paise (`100 paise = ₹1 INR`) using Hamilton Largest-Remainder allocation.
- **Debt Simplification**: Minimizes transfers across group members (`≤ N − 1` payments) without altering historical expenses.
- **Honest UPI QR Workflow**: Generates standard `upi://pay?...` QR codes and separates `recorded` payments from `confirmed` receipts.
- **Security**: Salted `scrypt` password hashing, HTTP-only session cookies, CSRF origin verification, rate limiting, and group membership RBAC guards.
- **Visual Identity**: Crisp daylight editorial UI, Three.js 3D geometric hero sculpture, GSAP choreography, and SVG analytics charts.

## Running Locally
1. Install dependencies: `npm install`
2. Configure environment variables in `.env` (optional: `GEMINI_API_KEY` for AI Help Assistant; falls back to built-in Help Centre automatically if unset).
3. Start the full-stack server on port 3000: `npm run dev`
4. Run automated unit tests: `npm test`
5. Build for production: `npm run build` && `npm start`

## Seeded Demo Credentials
- **Email**: `aarav@settleup.app`
- **Password**: `Demo@1234` (or click **"Explore Live Demo Workspace"** on the landing/login page)

## Academic Documentation
- `/docs/ACADEMIC_REPORT.md` — Abstract, SRS, ER/DFD/Sequence diagrams, Pseudocode, API reference
- `/docs/VTU_SUBJECT_MAPPING_AND_VIVA.md` — 1st–5th semester CSE subject mapping, slide outline, and Viva Q&A
- `/docs/schema.mysql.sql` — 1:1 normalized MySQL 8.0 DDL schema parity file
- `/LEARNING_NOTES.md` — Beginner-friendly module-by-module code guide
