import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { DEFAULT_CATEGORIES } from "../defaults";

export type DB = BetterSQLite3Database<typeof schema>;

const DDL = `
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS import_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS import_file_hash_idx ON import_history(file_hash);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  payment_method TEXT NOT NULL DEFAULT '現金',
  merchant TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  items TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  import_id INTEGER REFERENCES import_history(id),
  dedupe_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tx_date_idx ON transactions(date);
CREATE UNIQUE INDEX IF NOT EXISTS tx_dedupe_idx ON transactions(dedupe_hash);
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  amount INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS budget_unique_idx ON budgets(month, category_id);
CREATE TABLE IF NOT EXISTS category_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  source TEXT NOT NULL DEFAULT 'manual',
  hit_count INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS rule_keyword_idx ON category_rules(keyword);
`;

/** 空DBにデフォルトのカテゴリ・組み込みルール・既定予算を投入する。 */
export function seedIfEmpty(db: DB) {
  const count = db.select().from(schema.categories).all().length;
  if (count > 0) return;
  DEFAULT_CATEGORIES.forEach((c, i) => {
    const row = db
      .insert(schema.categories)
      .values({ name: c.name, kind: c.kind, color: c.color, sortOrder: i })
      .returning()
      .get();
    for (const kw of new Set(c.keywords.map((k) => k.toLowerCase()))) {
      db.insert(schema.categoryRules)
        .values({ keyword: kw, categoryId: row.id, source: "builtin" })
        .onConflictDoNothing()
        .run();
    }
  });
  db.insert(schema.budgets).values({ month: "default", categoryId: null, amount: 300000 }).run();
}

export function createDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(DDL);
  const db = drizzle(sqlite, { schema });
  seedIfEmpty(db);
  return db;
}

const g = globalThis as unknown as { __budgetDb?: DB };

export function getDb(): DB {
  if (!g.__budgetDb) {
    g.__budgetDb = createDb(process.env.DATABASE_PATH || path.join(process.cwd(), "data", "budget.db"));
  }
  return g.__budgetDb;
}
