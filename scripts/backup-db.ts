import 'dotenv/config';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const configuredPath = process.env.DB_PATH?.trim() || './settleup.db';
const sourcePath = path.resolve(process.cwd(), configuredPath);
if (!fs.existsSync(sourcePath)) {
  throw new Error(`Database file not found at ${sourcePath}. No empty database was created.`);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = `${sourcePath}.backup-${stamp}.db`;
const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
try {
  await source.backup(backupPath);
} catch (error) {
  fs.rmSync(backupPath, { force: true });
  throw error;
} finally {
  source.close();
}

try {
  const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
  let integrity = '';
  try {
    integrity = backup.pragma('integrity_check', { simple: true }) as string;
  } finally {
    backup.close();
  }
  if (integrity !== 'ok') {
    throw new Error(`Backup integrity check failed: ${integrity}`);
  }
  console.log(`Verified SQLite backup created: ${backupPath}`);
} catch (error) {
  fs.rmSync(backupPath, { force: true });
  throw error;
}
