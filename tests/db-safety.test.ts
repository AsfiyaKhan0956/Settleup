import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertDatabaseFileState } from '../server/dbSafety.ts';

test('development refuses orphaned SQLite WAL or SHM sidecars without a main database', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settleup-db-safety-'));
  const dbPath = path.join(dir, 'settleup.db');
  try {
    fs.writeFileSync(`${dbPath}-wal`, 'unverified wal');
    assert.throws(() => assertDatabaseFileState(dbPath, false), /sidecar files exist without the main database/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('production requires an existing persistent SQLite database', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settleup-db-safety-'));
  const dbPath = path.join(dir, 'missing.db');
  try {
    assert.throws(() => assertDatabaseFileState(dbPath, true), /does not exist/);
    fs.writeFileSync(dbPath, 'main database placeholder');
    assert.equal(assertDatabaseFileState(dbPath, true), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
