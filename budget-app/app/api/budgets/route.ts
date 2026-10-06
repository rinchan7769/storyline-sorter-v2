import { z } from "zod";
import { handle, json } from "@/lib/api";
import { getBudgets, listCategories, setBudget } from "@/lib/queries";
import { currentMonth } from "@/lib/date";

export const GET = handle((req: Request) => {
  const month = new URL(req.url).searchParams.get("month") || currentMonth();
  const b = getBudgets(month);
  return json({
    month,
    total: b.total,
    categories: listCategories().map((c) => ({ categoryId: c.id, amount: b.pick(c.id)?.amount ?? 0 })),
  });
});

const body = z.object({
  month: z.string().regex(/^(\d{4}-\d{2}|default)$/),
  categoryId: z.number().int().nullable(),
  amount: z.number().int().min(0),
});

export const PUT = handle(async (req: Request) => {
  const b = body.parse(await req.json());
  setBudget(b.month, b.categoryId, b.amount);
  return json({ ok: true });
});
