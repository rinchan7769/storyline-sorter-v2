import { eq } from "drizzle-orm";
import { z } from "zod";
import { handle, json } from "@/lib/api";
import { getDb } from "@/lib/db";
import { budgets, categories, categoryRules, transactions } from "@/lib/db/schema";

type Ctx = { params: Promise<{ id: string }> };

const patch = z.object({
  name: z.string().min(1).max(30).optional(),
  kind: z.enum(["fixed", "variable", "special"]).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const id = Number((await params).id);
  const row = getDb().update(categories).set(patch.parse(await req.json())).where(eq(categories.id, id)).returning().get();
  return row ? json(row) : json({ error: "見つかりません" }, 404);
});

/** 削除時、紐づく明細は「未分類」に戻し、ルール・予算は削除する。 */
export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const id = Number((await params).id);
  const db = getDb();
  db.transaction((tx) => {
    tx.update(transactions).set({ categoryId: null }).where(eq(transactions.categoryId, id)).run();
    tx.delete(categoryRules).where(eq(categoryRules.categoryId, id)).run();
    tx.delete(budgets).where(eq(budgets.categoryId, id)).run();
    tx.delete(categories).where(eq(categories.id, id)).run();
  });
  return json({ ok: true });
});
