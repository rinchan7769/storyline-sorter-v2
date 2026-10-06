import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export type CategoryKind = "fixed" | "variable" | "special";

/** 中分類。kind が大分類(固定費/変動費/特別費)。 */
export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  kind: text("kind", { enum: ["fixed", "variable", "special"] }).notNull(),
  color: text("color").notNull().default("#6366f1"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const importHistory = sqliteTable(
  "import_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: ["pdf", "receipt"] }).notNull(),
    filename: text("filename").notNull(),
    fileHash: text("file_hash").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("import_file_hash_idx").on(t.fileHash)],
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(), // YYYY-MM-DD
    amount: integer("amount").notNull(), // 円(支出は正)
    categoryId: integer("category_id").references(() => categories.id),
    paymentMethod: text("payment_method").notNull().default("現金"),
    merchant: text("merchant").notNull().default(""),
    memo: text("memo").notNull().default(""),
    items: text("items"), // JSON: レシート品目
    source: text("source", { enum: ["manual", "pdf", "receipt"] }).notNull().default("manual"),
    importId: integer("import_id").references(() => importHistory.id),
    dedupeHash: text("dedupe_hash"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("tx_date_idx").on(t.date),
    uniqueIndex("tx_dedupe_idx").on(t.dedupeHash),
  ],
);

/** categoryId が null の行は月の総予算。month は YYYY-MM または "default"。 */
export const budgets = sqliteTable(
  "budgets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    month: text("month").notNull(),
    categoryId: integer("category_id").references(() => categories.id),
    amount: integer("amount").notNull(),
  },
  (t) => [uniqueIndex("budget_unique_idx").on(t.month, t.categoryId)],
);

export const categoryRules = sqliteTable(
  "category_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    keyword: text("keyword").notNull(),
    categoryId: integer("category_id").notNull().references(() => categories.id),
    source: text("source", { enum: ["builtin", "manual", "learned"] }).notNull().default("manual"),
    hitCount: integer("hit_count").notNull().default(0),
  },
  (t) => [uniqueIndex("rule_keyword_idx").on(t.keyword)],
);
