SETTLEUP CLOUDFLARE INTEGRATION BATCH

This ZIP contains the replacement root worker.ts. It connects the Cloudflare route
modules that you have already created in the cloudflare/ folder.

HOW TO APPLY
1. Make sure this is your MAIN Settleup project, not your backup.
2. Extract this ZIP into the project root (the same folder that contains package.json).
3. Allow worker.ts to be replaced when Windows asks.
4. Do not delete or modify the existing server/ folder or local Express files.
5. Run: npx tsc --noEmit
6. Send me the exact result.

IMPORTANT
- This batch assumes these files already exist:
  cloudflare/auth.ts, expenses.ts, balances.ts, groups.ts, manualBalances.ts,
  notifications.ts, profile.ts, personal.ts, analytics.ts, assistant.ts,
  tripLedger.ts, and db.ts.
- It also assumes their exported handler names are handleAuth, handleExpenses,
  handleBalances, handleGroups, handleManualBalances, handleNotifications,
  handleProfile, handlePersonal, handleAnalytics, handleAssistant, and
  handleTripLedger.
- This only wires the API handlers together. It does NOT mean the migration is
  complete or ready to deploy. Frontend assets, missing feature parity, security,
  data import, and end-to-end tests remain.
- Do not push to GitHub or deploy yet.
