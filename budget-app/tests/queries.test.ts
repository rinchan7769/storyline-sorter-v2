import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type DB } from "@/lib/db";
import {
  annotateRows,
  commitImport,
  createTransaction,
  getBudgets,
  getDashboard,
  listCategories,
  listTransactions,
  setBudget,
  suggestFor,
  updateTransaction,
} from "@/lib/queries";

let db: DB;
const cat = (name: string) => listCategories(db).find((c) => c.name === name)!.id;
const row = (over: Partial<Parameters<typeof createTransaction>[0]> = {}) => ({
  date: "2025-09-03",
  amount: 1000,
  categoryId: null,
  paymentMethod: "クレジットカード",
  merchant: "テスト商店",
  memo: "",
  ...over,
});

beforeEach(() => {
  db = createDb(":memory:");
});

describe("取り込みと重複防止", () => {
  it("同じ明細の再取り込みはスキップし、同一ファイル内の同額複数行は残す", () => {
    const rows = [row(), row(), row({ amount: 500 })];
    const first = commitImport({ kind: "pdf", filename: "a.pdf", fileHash: "h1", rows }, db);
    expect(first).toMatchObject({ inserted: 3, skipped: 0 });
    const again = commitImport({ kind: "pdf", filename: "a2.pdf", fileHash: "h2", rows }, db);
    expect(again).toMatchObject({ inserted: 0, skipped: 3 });
    expect(listTransactions({}, db).count).toBe(3);
  });
  it("annotateRows が既存取り込みを重複として示す", () => {
    commitImport({ kind: "pdf", filename: "a.pdf", fileHash: "h1", rows: [row()] }, db);
    const ann = annotateRows([{ date: "2025-09-03", merchant: "テスト商店", amount: 1000 }], "クレジットカード", db);
    expect(ann[0].duplicate).toBe(true);
  });
  it("別画像のレシートは同内容でも別明細として登録できる", () => {
    commitImport({ kind: "receipt", filename: "1.jpg", fileHash: "a", rows: [row()] }, db);
    const r = commitImport({ kind: "receipt", filename: "2.jpg", fileHash: "b", rows: [row()] }, db);
    expect(r.inserted).toBe(1);
  });
});

describe("カテゴリ学習", () => {
  it("カテゴリを手修正すると同じ店舗が次回から自動分類される", () => {
    expect(suggestFor("謎の店", db)).toBeNull();
    const tx = createTransaction(row({ merchant: "謎の店" }), db);
    updateTransaction(tx.id, { categoryId: cat("趣味・娯楽") }, db);
    expect(suggestFor("謎の店 2号店", db)?.categoryId).toBe(cat("趣味・娯楽"));
  });
  it("組み込みルールが効く", () => {
    expect(suggestFor("スターバックス 渋谷", db)?.categoryId).toBe(cat("外食費"));
  });
});

describe("ダッシュボードと予算", () => {
  it("構成比・残予算・前月同期比を集計する", () => {
    createTransaction(row({ date: "2025-09-02", amount: 80000, categoryId: cat("住居費") }), db);
    createTransaction(row({ date: "2025-09-04", amount: 3000, categoryId: cat("食費") }), db);
    createTransaction(row({ date: "2025-08-02", amount: 70000, categoryId: cat("住居費") }), db);
    createTransaction(row({ date: "2025-08-20", amount: 9999, categoryId: cat("食費") }), db);
    setBudget("2025-09", null, 100000, db);
    const d = getDashboard("2025-09", new Date("2025-09-10T12:00:00+09:00"), db);
    expect(d.total).toBe(83000);
    expect(d.byKind).toEqual({ fixed: 80000, variable: 3000, special: 0 });
    expect(d.budget).toEqual({ total: 100000, remaining: 17000 });
    expect(d.prevSamePeriod).toBe(70000); // 8/20 は同期間(〜10日)に含まれない
    expect(d.prevTotal).toBe(79999);
    expect(d.daily[9].cumulative).toBe(83000);
    expect(d.daily[10].cumulative).toBeNull();
    expect(d.categories[0]).toMatchObject({ name: "住居費", amount: 80000 });
  });
  it("月別予算は既定予算より優先される", () => {
    expect(getBudgets("2025-09", db).total).toBe(300000);
    setBudget("2025-09", null, 250000, db);
    expect(getBudgets("2025-09", db).total).toBe(250000);
    expect(getBudgets("2025-10", db).total).toBe(300000);
  });
});
