# SettleUp — CSE (1st–5th Semester) Subject Mapping, Presentation & Viva Guide

## 1. Subject-to-Feature Mapping (VTU CSE Curriculum)

| Subject Area | Exact Concept | Where Implemented in SettleUp | Practical Example & Viva Explanation |
| :--- | :--- | :--- | :--- |
| **Programming Fundamentals** | Conditionals, loops, modular functions, input validation | `server/math.ts`, `src/utils/currency.ts` | Looping over bill items to compute `unit_price_paise * quantity` and validating split sums before saving. |
| **Engineering Mathematics** | Ratios, percentages, integer division, remainder distribution | `allocateByWeights()` in `server/math.ts` | Splitting ₹100 among 3 friends in integer paise (`3334, 3333, 3333`) using the Largest-Remainder method. |
| **Data Structures & Algorithms (DSA)** | Hash Maps (`Map`), Sorting, Greedy Graph Optimization | `simplifyDebts()` in `server/math.ts` | Representing net balances as a directed weighted graph and greedily matching largest creditor & debtor in `O(N log N)`. |
| **Database Management Systems (DBMS)** | 3NF Normalization, Foreign Keys, Composite Unique Keys, ACID Transactions | `server/db.ts`, `docs/schema.mysql.sql` | Saving an itemised expense atomically inserts rows across `expenses`, `expense_items`, `item_consumers`, and `expense_splits`. |
| **Discrete Mathematics** | Sets, Relations, Bipartite/Directed Graphs | `item_consumers` (relation between Items and Users), Debt Graph | Set deduplication prevents duplicate consumers on an item; sum of in-degrees equals sum of out-degrees (`∑ net = 0`). |
| **Web Technologies** | Semantic HTML5, Tailwind CSS, TypeScript, REST APIs, Three.js, SVG | `src/components/*`, `HeroVaultScene.tsx` | Responsive UI with `fetch(..., { credentials: 'include' })` and interactive SVG charts. |
| **Computer Networks** | Client-Server model, HTTP status codes (`401`, `403`, `404`, `429`), Cookies | `server.ts`, `server/security.ts` | HTTP-only session cookies, CSRF same-origin validation, and rate limiting on `/api/auth/*`. |
| **Software Engineering** | Modular architecture, Automated Unit Testing, Version-controlled docs | `tests/financial.test.ts`, `docs/` | Automated assertions verifying the 5-person Tea/Coffee/Samosa split and rounding invariants. |

---

## 2. Presentation Slide Outline (10 Slides)
1. **Title Slide**: SettleUp — Collaborative Group Expense & Item-Wise Settlement Platform.
2. **The Problem**: Why equal splits fail (5-person Tea ₹100, Coffee ₹120, Samosas ₹150 example).
3. **Objectives**: Paise accuracy, 5 split modes, debt graph simplification, honest UPI confirmation.
4. **System Architecture**: Client UI -> Express REST API -> Integer Financial Engine -> Relational DB.
5. **Database Design (ER)**: A normalized relational schema with 1:1, 1:N and M:N relationships, foreign-key constraints, versioned schema records and ACID transactions.
6. **Core Algorithm 1 — Item-Wise & Remainder Allocation**: Hamilton Largest-Remainder method.
7. **Core Algorithm 2 — Debt Simplification**: Greedy Min-Cash-Flow reducing transfers to `≤ N - 1`.
8. **Security & Privacy**: `scrypt` salted hashes, HTTP-only cookies, RBAC group membership guards.
9. **Live Demo Walkthrough**: Group QR invite -> Itemised bill -> Simplified balances -> UPI QR -> Analytics.
10. **Testing, Conclusion & Future Scope**: Automated test results, limitations, and next steps.

---

## 3. Essential Viva Questions & Model Answers

1. **Q: Why did you store money in integer `paise` instead of `FLOAT` or `DECIMAL`?**
   - *Model Answer*: Binary floating-point numbers (`0.1 + 0.2`) introduce representation errors in JavaScript/SQL. Storing `total_paise` as an integer (`₹370.00 = 37000 paise`) ensures exact arithmetic and lets us distribute remainder paise explicitly so splits always sum to the exact bill total.
2. **Q: Explain the Tea, Coffee, and Samosas test case.**
   - *Model Answer*: Five friends spend ₹370 total: Tea ₹100 shared by 4 (`₹25` each), Coffee ₹120 consumed by 1 (`₹120`), and Samosas ₹150 shared by all 5 (`₹30` each). SettleUp computes `₹55` each for the four tea drinkers and `₹150` for the coffee consumer, whereas a naive equal split would charge everyone `₹74`.
3. **Q: How does your debt simplification algorithm work, and what is its time complexity?**
   - *Model Answer*: First we compute each member's net balance (`Paid - Owed + Confirmed Settlements Paid - Confirmed Settlements Received`). Then we sort creditors and debtors (`O(N log N)`) and greedily settle `min(debtor, creditor)` in a two-pointer loop (`O(N)`), producing at most `N − 1` transfers.
4. **Q: Why doesn’t scanning the UPI QR code automatically mark an expense as settled?**
   - *Model Answer*: Because SettleUp is a ledger, not a banking gateway. Scanning a QR opens an external app (GPay/PhonePe) where the user could cancel the payment. Therefore, SettleUp marks a submitted UTR as `recorded` (`Awaiting Confirmation`) and only clears balances once the recipient confirms receipt (`confirmed`).
5. **Q: What happens if two operations try to update an expense or settlement simultaneously?**
   - *Model Answer*: All multi-table writes (`expenses`, `expense_items`, `item_consumers`, `expense_splits`, `activity_logs`) execute inside an ACID database transaction (`db.transaction(...)`). Either all records commit together or everything rolls back cleanly.
6. **Q: How do you prevent a user from viewing another private group’s expenses?**
   - *Model Answer*: Every group, expense, balance, and settlement endpoint invokes `requireAuth` (verifying the signed session token) followed by `getMembership(groupId, userId)` against `group_members`. Non-members receive HTTP `403 Forbidden`.
7. **Q: Why can’t an admin delete a member who still owes money?**
   - *Model Answer*: Removing a member with a non-zero balance would break the group's zero-sum invariant (`∑ net_paise = 0`). Our `DELETE /api/groups/:id/members/:memberId` route verifies `member.netPaise === 0` before allowing removal.
