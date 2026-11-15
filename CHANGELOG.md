# Changelog

## v1.0.0 — Complete SettleUp Rebuild
- Built relational SQLite schema (`server/db.ts`) with 14 normalized tables, foreign keys, check constraints, and 1:1 MySQL parity (`docs/schema.mysql.sql`).
- Implemented exact integer-paise split engine (`server/math.ts`) supporting Equal, Exact, Percentage, Shares, and Item-wise splits with proportional tax/tip/discount.
- Implemented Greedy Min-Cash-Flow debt simplification and honest two-step UPI QR settlement confirmation.
- Built crisp daylight fintech UI with Three.js 3D hero sculpture, GSAP scroll choreography, interactive 5-person Tea/Coffee/Samosa landing calculator, SVG analytics charts, CSV/Print exports, interactive guided tour, and server-side Gemini AI Help Assistant.
- Added automated unit test suite (`tests/financial.test.ts`) and full CSE academic & viva documentation (`/docs/`).
