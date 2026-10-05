import { and, asc, desc, eq, gte, isNull, like, lte, or, sql, type SQL } from "drizzle-orm";
import { getDb, type DB } from "./db";
import { budgets, categories, categoryRules, importHistory, transactions, type CategoryKind } from "./db/schema";
import { merchantKey, suggestCategory, type Rule } from "./categorize";
import { hashRows } from "./dedupe";
import { currentMonth, jstNow } from "./date";

export type TxInput = {
  date: string;
  amount: number;
  categoryId: number | null;
  paymentMethod: string;
  merchant: string;
  memo: string;
  items?: string | null;
};

const now = () => new Date().toISOString();

export function listCategories(db: DB = getDb()) {
  return db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.id)).all();
}

export function listRules(db: DB = getDb()) {
  return db.select().from(categoryRules).orderBy(desc(categoryRules.id)).all();
}

function rulesForMatching(db: DB): Rule[] {
  return db
    .select({ keyword: categoryRules.keyword, categoryId: categoryRules.categoryId, source: categoryRules.source })
    .from(categoryRules)
    .all();
}

export function suggestFor(text: string, db: DB = getDb()) {
  return suggestCategory(text, rulesForMatching(db));
}

/** 手修正した内容を学習ルールとして保存する(同じ店舗名の次回以降を自動分類)。 */
export function learnRule(merchant: string, categoryId: number, db: DB = getDb()) {
  const key = merchantKey(merchant);
  if (key.length < 2) return;
  const existing = db.select().from(categoryRules).where(eq(categoryRules.keyword, key)).get();
  if (existing?.source === "manual") return;
  db.insert(categoryRules)
    .values({ keyword: key, categoryId, source: "learned" })
    .onConflictDoUpdate({ target: categoryRules.keyword, set: { categoryId, source: "learned" } })
    .run();
}

export type TxFilter = {
  month?: string;
  from?: string;
  to?: string;
  categoryId?: number;
  kind?: CategoryKind;
  paymentMethod?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

export function listTransactions(f: TxFilter, db: DB = getDb()) {
  const conds: SQL[] = [];
  if (f.month) conds.push(like(transactions.date, `${f.month}-%`));
  if (f.from) conds.push(gte(transactions.date, f.from));
  if (f.to) conds.push(lte(transactions.date, f.to));
  if (f.categoryId) conds.push(eq(transactions.categoryId, f.categoryId));
  if (f.kind) conds.push(eq(categories.kind, f.kind));
  if (f.paymentMethod) conds.push(eq(transactions.paymentMethod, f.paymentMethod));
  if (f.q) {
    const p = `%${f.q.replace(/[%_]/g, (c) => `\\${c}`)}%`;
    conds.push(
      or(
        sql`${transactions.merchant} LIKE ${p} ESCAPE '\\'`,
        sql`${transactions.memo} LIKE ${p} ESCAPE '\\'`,
        sql`${transactions.items} LIKE ${p} ESCAPE '\\'`,
      )!,
    );
  }
  const where = conds.length ? and(...conds) : undefined;
  const base = db
    .select({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      kind: categories.kind,
      color: categories.color,
      paymentMethod: transactions.paymentMethod,
      merchant: transactions.merchant,
      memo: transactions.memo,
      items: transactions.items,
      source: transactions.source,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(where);
  const rows = base
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(f.limit ?? 500)
    .offset(f.offset ?? 0)
    .all();
  const agg = db
    .select({ total: sql<number>`COALESCE(SUM(${transactions.amount}),0)`, count: sql<number>`COUNT(*)` })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(where)
    .get()!;
  return { rows, total: agg.total, count: agg.count };
}

export function createTransaction(input: TxInput, db: DB = getDb()) {
  // カテゴリ未指定なら店舗名・メモから自動推測する
  const categoryId = input.categoryId ?? suggestFor(`${input.merchant} ${input.memo}`, db)?.categoryId ?? null;
  const row = db
    .insert(transactions)
    .values({ ...input, categoryId, items: input.items ?? null, source: "manual", createdAt: now() })
    .returning()
    .get();
  return row;
}

export function updateTransaction(id: number, patch: Partial<TxInput>, db: DB = getDb()) {
  const before = db.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!before) return null;
  const row = db.update(transactions).set(patch).where(eq(transactions.id, id)).returning().get();
  if (patch.categoryId && patch.categoryId !== before.categoryId && row.merchant) {
    learnRule(row.merchant, patch.categoryId, db);
  }
  return row;
}

export function deleteTransaction(id: number, db: DB = getDb()) {
  db.delete(transactions).where(eq(transactions.id, id)).run();
}

export type PreviewRow = {
  date: string;
  merchant: string;
  amount: number;
  paymentMethod: string;
  categoryId: number | null;
  duplicate: boolean;
  uncertain?: boolean;
};

/** 取り込み候補行にカテゴリ推測と重複フラグを付与する。 */
export function annotateRows(
  rows: { date: string; merchant: string; amount: number; uncertain?: boolean }[],
  paymentMethod: string,
  db: DB = getDb(),
): PreviewRow[] {
  const rules = rulesForMatching(db);
  const hashed = hashRows(rows.map((r) => ({ ...r, paymentMethod })));
  const existing = new Set(
    db.select({ h: transactions.dedupeHash }).from(transactions).all().map((r) => r.h),
  );
  return hashed.map((r) => ({
    date: r.date,
    merchant: r.merchant,
    amount: r.amount,
    paymentMethod,
    uncertain: r.uncertain,
    categoryId: suggestCategory(r.merchant, rules)?.categoryId ?? null,
    duplicate: existing.has(r.dedupeHash),
  }));
}

export function findImportByHash(fileHash: string, db: DB = getDb()) {
  return db.select().from(importHistory).where(eq(importHistory.fileHash, fileHash)).get() ?? null;
}

export type CommitRow = TxInput & { items?: string | null };

/** 取り込みを確定する。重複ハッシュの行はスキップし、手修正されたカテゴリは学習する。 */
export function commitImport(
  args: { kind: "pdf" | "receipt"; filename: string; fileHash: string; rows: CommitRow[] },
  db: DB = getDb(),
) {
  return db.transaction((tx) => {
    const t = tx as unknown as DB;
    const hist = t
      .insert(importHistory)
      .values({ kind: args.kind, filename: args.filename, fileHash: args.fileHash, createdAt: now() })
      .returning()
      .get();
    const suggestRules = rulesForMatching(t);
    const hashed = hashRows(args.rows, args.kind === "receipt" ? args.fileHash : "");
    let inserted = 0;
    let skipped = 0;
    for (const r of hashed) {
      const res = t
        .insert(transactions)
        .values({
          date: r.date,
          amount: r.amount,
          categoryId: r.categoryId,
          paymentMethod: r.paymentMethod,
          merchant: r.merchant,
          memo: r.memo,
          items: r.items ?? null,
          source: args.kind,
          importId: hist.id,
          dedupeHash: r.dedupeHash,
          createdAt: now(),
        })
        .onConflictDoNothing()
        .run();
      if (res.changes === 0) {
        skipped++;
        continue;
      }
      inserted++;
      const sug = suggestCategory(r.merchant, suggestRules);
      if (r.categoryId && r.merchant && sug?.categoryId !== r.categoryId) learnRule(r.merchant, r.categoryId, t);
    }
    if (inserted === 0) {
      // 全行が重複なら履歴を残さない
      t.delete(importHistory).where(eq(importHistory.id, hist.id)).run();
      return { importId: null, inserted, skipped };
    }
    t.update(importHistory).set({ rowCount: inserted, skippedCount: skipped }).where(eq(importHistory.id, hist.id)).run();
    return { importId: hist.id, inserted, skipped };
  });
}

export function listImports(db: DB = getDb()) {
  return db.select().from(importHistory).orderBy(desc(importHistory.id)).limit(20).all();
}

// ---- 予算 ----
export function getBudgets(month: string, db: DB = getDb()) {
  const all = db.select().from(budgets).where(or(eq(budgets.month, month), eq(budgets.month, "default"))).all();
  const pick = (catId: number | null) =>
    all.find((b) => b.month === month && b.categoryId === catId) ??
    all.find((b) => b.month === "default" && b.categoryId === catId) ??
    null;
  return { total: pick(null)?.amount ?? 0, pick };
}

export function setBudget(month: string, categoryId: number | null, amount: number, db: DB = getDb()) {
  db.delete(budgets)
    .where(and(eq(budgets.month, month), categoryId === null ? isNull(budgets.categoryId) : eq(budgets.categoryId, categoryId)))
    .run();
  if (amount > 0) db.insert(budgets).values({ month, categoryId, amount }).run();
}

// ---- ダッシュボード ----
export function prevMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function daysInMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function getDashboard(month: string, today = new Date(), db: DB = getDb()) {
  const rows = db
    .select({
      date: transactions.date,
      amount: transactions.amount,
      merchant: transactions.merchant,
      categoryId: transactions.categoryId,
    })
    .from(transactions)
    .where(like(transactions.date, `${month}-%`))
    .all();
  const prevRows = db
    .select({ date: transactions.date, amount: transactions.amount })
    .from(transactions)
    .where(like(transactions.date, `${prevMonth(month)}-%`))
    .all();
  const cats = listCategories(db);
  const catById = new Map(cats.map((c) => [c.id, c]));

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const byKind: Record<CategoryKind, number> = { fixed: 0, variable: 0, special: 0 };
  const byCat = new Map<number | null, { amount: number; merchants: Map<string, { amount: number; count: number }> }>();
  for (const r of rows) {
    const cat = r.categoryId ? catById.get(r.categoryId) : undefined;
    if (cat) byKind[cat.kind] += r.amount;
    const e = byCat.get(r.categoryId) ?? { amount: 0, merchants: new Map() };
    e.amount += r.amount;
    const mk = r.merchant || "(店名なし)";
    const m = e.merchants.get(mk) ?? { amount: 0, count: 0 };
    m.amount += r.amount;
    m.count += 1;
    e.merchants.set(mk, m);
    byCat.set(r.categoryId, e);
  }
  const categoriesOut = [...byCat.entries()]
    .map(([id, e]) => {
      const c = id ? catById.get(id) : undefined;
      return {
        id,
        name: c?.name ?? "未分類",
        kind: c?.kind ?? null,
        color: c?.color ?? "#94a3b8",
        amount: e.amount,
        details: [...e.merchants.entries()]
          .map(([name, v]) => ({ name, ...v }))
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 10),
      };
    })
    .sort((a, b) => b.amount - a.amount);

  const dim = daysInMonth(month);
  const isCurrent = currentMonth(today) === month;
  const lastDay = isCurrent ? jstNow(today).getUTCDate() : dim;
  const perDay = new Array(dim + 1).fill(0);
  const prevPerDay = new Array(daysInMonth(prevMonth(month)) + 1).fill(0);
  for (const r of rows) perDay[+r.date.slice(8, 10)] += r.amount;
  for (const r of prevRows) prevPerDay[+r.date.slice(8, 10)] += r.amount;
  let cum = 0;
  let prevCum = 0;
  const daily = Array.from({ length: dim }, (_, i) => {
    const day = i + 1;
    cum += perDay[day];
    prevCum += prevPerDay[day] ?? 0;
    return { day, amount: perDay[day], cumulative: day <= lastDay ? cum : null, prevCumulative: prevCum };
  });
  const prevSamePeriod = prevPerDay.slice(1, lastDay + 1).reduce((s, v) => s + v, 0);
  const prevTotal = prevPerDay.reduce((s, v) => s + v, 0);

  const b = getBudgets(month, db);
  const categoryBudgets = cats
    .map((c) => {
      const amount = b.pick(c.id)?.amount ?? 0;
      const spent = byCat.get(c.id)?.amount ?? 0;
      return { id: c.id, name: c.name, color: c.color, budget: amount, spent };
    })
    .filter((c) => c.budget > 0);

  return {
    month,
    total,
    count: rows.length,
    byKind,
    categories: categoriesOut,
    daily,
    prevSamePeriod,
    prevTotal,
    budget: { total: b.total, remaining: b.total - total },
    categoryBudgets,
    daysLeft: isCurrent ? dim - lastDay + 1 : 0,
  };
}
