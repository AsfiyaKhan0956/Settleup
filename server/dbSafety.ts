import { existsSync } from 'node:fs';

/** Prevents SQLite from silently opening a fresh empty database over orphaned WAL/SHM files. */
export function assertDatabaseFileState(dbPath: string, isProduction: boolean): boolean {
  if (isProduction && (!dbPath.trim() || dbPath === ':memory:')) {
    throw new Error('Production requires DB_PATH to point to an existing persistent SQLite database file.');
  }
  const mainExists = dbPath !== ':memory:' && existsSync(dbPath);
  const hasOrphanedSidecars = dbPath !== ':memory:' && !mainExists && (existsSync(`${dbPath}-wal`) || existsSync(`${dbPath}-shm`));
  if (hasOrphanedSidecars) {
    throw new Error(`SQLite sidecar files exist without the main database at ${dbPath}. SettleUp will not create a new empty database over these recovery files. Restore the main database or make a verified backup before proceeding.`);
  }
  if (isProduction && !mainExists) {
    throw new Error(`The configured production database does not exist at ${dbPath}. SettleUp will not create a new empty database.`);
  }
  return mainExists;
}
