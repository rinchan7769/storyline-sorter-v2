import { handle, json } from "@/lib/api";
import { deleteTransaction, updateTransaction } from "@/lib/queries";
import { txPatch } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const row = updateTransaction(Number(id), txPatch.parse(await req.json()));
  return row ? json(row) : json({ error: "見つかりません" }, 404);
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  deleteTransaction(Number(id));
  return json({ ok: true });
});
