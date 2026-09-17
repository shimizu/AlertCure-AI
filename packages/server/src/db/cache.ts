import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DEFAULT_DB_PATH = join(homedir(), ".alertcure", "alertcure.sqlite");

export interface CacheEntry<T> {
  value: T;
  fetchedAt: string;
}

/** GitHub API の取得結果を JSON で保存するキャッシュ */
export class Cache {
  private readonly db: DatabaseSync;

  constructor(path: string = process.env.ALERTCURE_DB ?? DEFAULT_DB_PATH) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      )
    `);
  }

  get<T>(key: string): CacheEntry<T> | undefined {
    const row = this.db
      .prepare("SELECT value, fetched_at FROM cache WHERE key = ?")
      .get(key) as { value: string; fetched_at: string } | undefined;
    if (!row) return undefined;
    return { value: JSON.parse(row.value) as T, fetchedAt: row.fetched_at };
  }

  set<T>(key: string, value: T, fetchedAt: Date = new Date()): CacheEntry<T> {
    const entry = { value, fetchedAt: fetchedAt.toISOString() };
    this.db
      .prepare(
        `INSERT INTO cache (key, value, fetched_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at`,
      )
      .run(key, JSON.stringify(value), entry.fetchedAt);
    return entry;
  }

  delete(key: string): void {
    this.db.prepare("DELETE FROM cache WHERE key = ?").run(key);
  }

  close(): void {
    this.db.close();
  }
}

/** キャッシュがあれば返し、なければ（または refresh 指定時は）取得して保存する */
export async function cached<T>(
  cache: Cache,
  key: string,
  refresh: boolean,
  load: () => Promise<T>,
): Promise<CacheEntry<T>> {
  if (!refresh) {
    const hit = cache.get<T>(key);
    if (hit) return hit;
  }
  return cache.set(key, await load());
}
