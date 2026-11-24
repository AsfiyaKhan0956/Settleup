
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dbPath = path.resolve("settleup.db");
const outputPath = path.resolve("cloudflare-local-data.json");

if (!fs.existsSync(dbPath)) {
  console.error("Database not found: " + dbPath);
  console.error("Run this script from your main SettleUp project folder.");
  process.exit(1);
}

const db = new Database(dbPath, {
  readonly: true,
  fileMustExist: true
});

try {
  const tableNames = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map(row => row.name);

  if (!tableNames.includes("users")) {
    throw new Error("The database has no users table.");
  }

  const userCount = db
    .prepare('SELECT COUNT(*) AS n FROM "users"')
    .get().n;

  if (userCount < 1) {
    throw new Error("No users found. Export cancelled.");
  }

  const excluded = new Set([
    "sessions",
    "guest_sessions",
    "password_resets",
    "schema_migrations"
  ]);

  const tables = {};

  for (const table of tableNames) {
    if (excluded.has(table)) continue;

    const quoted = `"${table.replaceAll('"', '""')}"`;
    tables[table] = db.prepare(`SELECT * FROM ${quoted}`).all();
  }

  const payload = {
    format: "settleup-local-export-v1",
    exportedAt: new Date().toISOString(),
    sourceDatabase: "settleup.db",
    excludedTables: [...excluded],
    tables
  };

  fs.writeFileSync(
    outputPath,
    JSON.stringify(payload, null, 2),
    "utf8"
  );

  console.log("EXPORT COMPLETED SUCCESSFULLY");
  console.log("Original database was opened read-only.");
  console.log("Users found: " + userCount);
  console.log("Exported table counts:");

  for (const [table, rows] of Object.entries(tables)) {
    if (rows.length > 0) {
      console.log(`  ${table}: ${rows.length}`);
    }
  }

  console.log("Created file: " + outputPath);
  console.log("Upload cloudflare-local-data.json here.");
  console.log("Do not run any D1 import command yet.");

} catch (error) {
  console.error("EXPORT FAILED:", error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
