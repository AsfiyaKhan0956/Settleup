import 'dotenv/config';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const configuredPath = process.env.DB_PATH?.trim();
if (process.env.NODE_ENV === 'production' && (!configuredPath || configuredPath === ':memory:')) {
  throw new Error('Set DB_PATH to the permanent database location in .env before initializing production.');
}
const dbPath = configuredPath || path.resolve(process.cwd(), 'settleup.db');
if (dbPath === ':memory:') throw new Error('A persistent file path is required for the main database.');
const absolutePath = path.resolve(process.cwd(), dbPath);
if (existsSync(absolutePath)) {
  console.log(`Main database already exists: ${absolutePath}`);
  console.log('It was not overwritten. Existing data is preserved.');
  process.exit(0);
}
if (existsSync(`${absolutePath}-wal`) || existsSync(`${absolutePath}-shm`)) {
  throw new Error(`SQLite WAL/SHM sidecar files exist without the main database at ${absolutePath}. Move them to a safe recovery folder before creating a fresh database.`);
}
mkdirSync(path.dirname(absolutePath), { recursive: true });
process.env.DB_INIT_MODE = 'true';
const { db, initializeDatabase } = await import('../server/db.ts');
try {
  initializeDatabase();
  db.pragma('wal_checkpoint(TRUNCATE)');
  const result = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
  if (result.integrity_check !== 'ok') throw new Error(`SQLite integrity check failed: ${result.integrity_check}`);
  console.log(`Main SettleUp database created: ${absolutePath}`);
  console.log('The database has the current application schema and starts empty.');
} finally {
  db.close();
}
