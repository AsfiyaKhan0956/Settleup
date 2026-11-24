
export interface CloudflareEnv {
  DB: D1Database;
}

export async function dbAll<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await db.prepare(sql).bind(...params).all<T>();
  return result.results ?? [];
}

export async function dbFirst<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  return await db.prepare(sql).bind(...params).first<T>();
}

export async function dbRun(
  db: D1Database,
  sql: string,
  params: unknown[] = []
) {
  return await db.prepare(sql).bind(...params).run();
}

export async function dbBatch(
  db: D1Database,
  statements: D1PreparedStatement[]
) {
  return await db.batch(statements);
}
