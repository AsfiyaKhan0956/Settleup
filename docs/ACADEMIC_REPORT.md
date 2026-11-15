# SettleUp — Complete Engineering Project Documentation

## 1. Project Abstract
**SettleUp** is a full-stack collaborative group expense management and settlement platform built to eliminate unfair bill splitting and manual spreadsheet reconciliation among friends, flatmates, families, and travel groups. Unlike basic trackers that force equal divisions, SettleUp introduces an item-wise splitting engine using exact integer-paise arithmetic (`100 paise = ₹1 INR`), graph-based debt simplification (greedy minimum-cash-flow matching), scannable QR group invitations, and an honest two-step UPI payment QR confirmation workflow.

---

## 2. Problem Statement
In everyday shared outings—such as five college friends visiting a café where four drink tea (₹100), one orders specialty coffee (₹120), and all five share samosas (₹150)—equal division charges everyone ₹74 instead of ₹55 for tea drinkers and ₹150 for the coffee consumer. Existing manual chats and spreadsheets suffer from:
1. Unfair equal splits when participants consume different items.
2. Floating-point rounding errors (`0.1 + 0.2 !== 0.3`) causing ledgers to drift by ₹0.01–₹0.05.
3. Redundant circular debt transfers (`A -> B -> C -> A`) across multi-expense groups.
4. Lack of transparent audit trails and premature settlement assumptions when using payment QRs.

---

## 3. Objectives
1. Design a 3NF normalized relational database enforcing foreign keys, check constraints, and ACID financial transactions.
2. Implement five server-validated splitting modes (`Equal`, `Exact`, `Percentage`, `Shares`, and `Item-wise` with proportional tax/tip/discount).
3. Eliminate floating-point money bugs by computing and storing all currency values in integer **paise**.
4. Implement a greedy min-cash-flow debt simplification algorithm reducing group transfers to at most `N − 1`.
5. Provide real-time SQL analytics, CSV/PDF reports, secure authentication, interactive guided onboarding, and a server-side Gemini AI help assistant.

---

## 4. Existing System vs. Proposed System

| Aspect | Existing System (Chats / Basic Splitters) | Proposed System (SettleUp) |
| :--- | :--- | :--- |
| Item-level attribution | Manual math in chat messages | Structured `expense_items` + `item_consumers` tables |
| Arithmetic precision | Floating-point decimals | Integer paise + Hamilton Largest-Remainder allocation |
| Group debt settlement | Pairwise IOUs across every bill | Greedy min-cash-flow graph simplification (`≤ N - 1`) |
| Payment QR honesty | Often marks paid on click/scan | Two-step flow (`recorded` -> recipient `confirmed`) |
| Analytics & export | Static or absent | Real SQL aggregations, SVG charts, CSV & Print/PDF |

---

## 5. System Architecture & Diagrams

### 5.1 Entity-Relationship (ER) Diagram
```
┌───────────────┐ 1     1 ┌───────────────────┐
│     users     ├─────────┤ user_preferences  │
└───────┬───────┘         └───────────────────┘
        │ 1
        │ (M:N via group_members)
        ▼ N
┌───────────────┐ N     1 ┌───────────────────┐ 1     N ┌───────────────────┐
│ group_members ├─────────┤      groups       ├─────────┤    invitations    │
└───────────────┘         └─────────┬─────────┘         └───────────────────┘
                                    │ 1
                   ┌────────────────┴────────────────┐
                   ▼ N                               ▼ N
           ┌───────────────┐                 ┌───────────────┐
           │   expenses    │                 │  settlements  │
           └───────┬───────┘                 └───────────────┘
                   │ 1
       ┌───────────┴───────────┐
       ▼ N                     ▼ N
┌──────────────┐       ┌───────────────┐
│expense_items │       │expense_splits │
└──────┬───────┘       └───────────────┘
       │ 1
       ▼ N
┌──────────────┐
│item_consumers│
└──────────────┘
```

### 5.2 Data Flow Diagram (DFD Level 0 & Level 1)
```
Level 0 (Context Diagram):
  [Group Member] ──(Credentials, Expense Items, UTR Ref)──> (( SettleUp System )) ──(Balances, UPI QR, Analytics, CSV)──> [Group Member]

Level 1 (Core Financial Flow):
  [User] ──> (1.0 Auth & Session Guard) ──> [D1: users, sessions]
  [User] ──> (2.0 Group & Invite Mgr)   ──> [D2: groups, group_members, invitations]
  [User] ──> (3.0 Integer Split Engine) ──> [D3: expenses, expense_items, item_consumers, expense_splits]
  [D3]   ──> (4.0 Debt Graph Engine)    ──> [Suggested Transfers] ──> (5.0 Settlement & UPI QR) ──> [D4: settlements]
```

### 5.3 Sequence Diagram (Item-Wise Expense Creation)
```
User UI             Express API          Split Engine           SQLite DB
  │                      │                     │                    │
  ├─ POST /api/expenses ─>                     │                    │
  │                      ├─ verify membership ─┼───────────────────>│
  │                      ├─ calculateSplits() ─>                    │
  │                      │<─ exact paise map ──┤                    │
  │                      ├─ BEGIN TRANSACTION ─┼───────────────────>│
  │                      ├─ INSERT expenses, items, consumers, splits
  │                      ├─ COMMIT ────────────┼───────────────────>│
  │<─ 201 Created ───────┤                     │                    │
```

---

## 6. Key Algorithms & Pseudocode

### 6.1 Hamilton Largest-Remainder Allocation (`allocateByWeights`)
```
Input: targetTotal (integer paise), entries = [(userId, weight)]
1. totalWeight = sum(entry.weight)
2. For each entry i:
     exact[i] = (targetTotal * entry.weight) / totalWeight
     floored[i] = floor(exact[i])
     rem[i] = exact[i] - floored[i]
3. leftover = targetTotal - sum(floored)
4. Sort indices by rem[i] descending (tie-break by original index)
5. Add +1 paise to the top `leftover` entries
Return map(userId -> floored[i])
Invariant: sum(returned paise) === targetTotal ALWAYS
```

### 6.2 Greedy Min-Cash-Flow Debt Simplification (`simplifyDebts`)
```
Input: members[] with netPaise = paid - owed + settledPaid - settledReceived
1. creditors = sortDesc([m where m.netPaise > 0], by netPaise)
2. debtors   = sortDesc([m where m.netPaise < 0], by |netPaise|)
3. i = 0, j = 0, transfers = []
4. While i < len(debtors) and j < len(creditors):
     amt = min(debtors[i].rem, creditors[j].rem)
     transfers.push(debtors[i] -> creditors[j] : amt)
     debtors[i].rem -= amt; creditors[j].rem -= amt
     if debtors[i].rem == 0: i++
     if creditors[j].rem == 0: j++
Return transfers (at most N - 1 edges)
```

---

## 7. REST API Documentation

- `POST /api/auth/register` · `POST /api/auth/login` · `POST /api/auth/demo` · `POST /api/auth/logout` · `GET /api/auth/me`
- `POST /api/auth/forgot-password` · `POST /api/auth/reset-password` · `POST /api/auth/change-password`
- `GET /api/groups` · `POST /api/groups` · `GET /api/groups/:id` · `PATCH /api/groups/:id` · `DELETE /api/groups/:id`
- `POST /api/groups/:id/members` · `PATCH /api/groups/:id/members/:memberId/role` · `DELETE /api/groups/:id/members/:memberId`
- `POST /api/groups/:id/invitations` · `GET /api/groups/invite/:token` · `POST /api/groups/invite/:token/accept`
- `GET /api/expenses` · `POST /api/expenses` · `GET /api/expenses/:id` · `PUT /api/expenses/:id` · `DELETE /api/expenses/:id`
- `GET /api/balances/overview` · `POST /api/balances/upi-qr` · `POST /api/balances/settlements` · `POST /api/balances/settlements/:id/confirm`
- `GET /api/analytics/summary` · `GET /api/analytics/export.csv`
- `GET /api/notifications` · `POST /api/notifications/mark-read` · `PATCH /api/profile` · `POST /api/assistant`

---

## 8. Limitations & Future Enhancements
- **Current Limitations**: In local/preview mode without an SMTP server, password reset displays the generated recovery token safely in-app for testing; UPI QR confirmation relies on recipient confirmation rather than a paid banking webhook.
- **Future Enhancements**: Automated bank/UPI webhook reconciliation, OCR receipt line-item extraction, recurring monthly rent/subscription expenses, and multi-currency FX conversion.

