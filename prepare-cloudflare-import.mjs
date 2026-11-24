
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const inputPath = path.resolve("cloudflare-local-data.json");
const outputPath = path.resolve("cloudflare-import.sql");

if (!fs.existsSync(inputPath)) {
  console.error("ERROR: cloudflare-local-data.json not found.");
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(inputPath, "utf8"));

if (payload.format !== "settleup-local-export-v1") {
  throw new Error("Unexpected export format. Import preparation cancelled.");
}

const tables = payload.tables;

if (!tables.users || tables.users.length !== 1) {
  throw new Error("Expected exactly one original user. Import preparation cancelled.");
}

// Parent tables first, so foreign-key references exist before child records.
const insertOrder = [
  "users",
  "user_preferences",
  "groups",
  "group_members",
  "invitations",
  "expenses",
  "expense_items",
  "item_consumers",
  "expense_splits",
  "settlements",
  "notifications",
  "activity_logs",
  "personal_categories",
  "personal_transactions",
  "personal_budgets",
  "personal_savings_goals",
  "trip_ledgers",
  "external_participants",
  "manual_balances",
  "manual_balance_events",
  "trip_ledger_participants",
  "trip_ledger_expenses",
  "trip_ledger_items",
  "trip_ledger_item_consumers",
  "trip_ledger_shares",
  "trip_ledger_settlements"
];

// Child tables first, so existing test records can be removed safely.
const deleteOrder = [...insertOrder].reverse();

const quoteIdentifier = (name) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error("Invalid SQL identifier: " + name);
  }
  return `"${name}"`;
};

const sqlValue = (value) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Invalid number in export.");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "string") {
    return "'" + value.replaceAll("'", "''") + "'";
  }
  throw new Error("Unsupported value in export.");
};

const statements = [];

statements.push("-- SettleUp local data import");
statements.push("-- Generated locally. Review before remote execution.");
statements.push("");

// Clear temporary records first because they reference users and groups.
for (const table of [
  "guest_sessions",
  "password_resets",
  "sessions"
]) {
  statements.push(`DELETE FROM ${quoteIdentifier(table)};`);
}

// Then clear application records in child-to-parent order.
for (const table of deleteOrder) {
  statements.push(`DELETE FROM ${quoteIdentifier(table)};`);
}

statements.push("");

let totalRows = 0;

for (const table of insertOrder) {
  const rows = tables[table] || [];

  for (const row of rows) {
    const columns = Object.keys(row);

    if (columns.length === 0) continue;

    const columnSql = columns.map(quoteIdentifier).join(", ");
    const valueSql = columns.map((key) => sqlValue(row[key])).join(", ");

    statements.push(
      `INSERT INTO ${quoteIdentifier(table)} (${columnSql}) VALUES (${valueSql});`
    );

    totalRows++;
  }
}

// Invalidate the invitation token exposed in the shared export.
// The invitation itself remains pending with a fresh, unpredictable token.
if (tables.invitations?.length) {
  const invitation = tables.invitations[0];
  const freshToken = crypto.randomBytes(24).toString("hex");

  statements.push(
    `UPDATE "invitations" SET "token" = ${sqlValue(freshToken)} WHERE "id" = ${sqlValue(invitation.id)};`
  );
}

fs.writeFileSync(outputPath, statements.join("\n") + "\n", "utf8");

console.log("IMPORT SQL PREPARED SUCCESSFULLY");
console.log("Records prepared: " + totalRows);
console.log("Output: " + outputPath);
console.log("Your original settleup.db was not changed.");
console.log("Cloudflare D1 was not contacted or changed.");
console.log("Do not execute the SQL yet. Send me the output first.");
