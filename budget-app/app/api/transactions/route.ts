import { handle, json } from "@/lib/api";
import { createTransaction, listTransactions } from "@/lib/queries";
import { txInput } from "@/lib/schemas";

export const GET = handle((req: Request) => {
  const p = new URL(req.url).searchParams;
  const num = (k: string) => (p.get(k) ? Number(p.get(k)) : undefined);
  const kind = p.get("kind");
  return json(
    listTransactions({
      month: p.get("month") || undefined,
      from: p.get("from") || undefined,
      to: p.get("to") || undefined,
      categoryId: num("categoryId"),
      kind: kind === "fixed" || kind === "variable" || kind === "special" ? kind : undefined,
      paymentMethod: p.get("paymentMethod") || undefined,
      q: p.get("q") || undefined,
      limit: num("limit"),
      offset: num("offset"),
    }),
  );
});

export const POST = handle(async (req: Request) => {
  const body = txInput.parse(await req.json());
  return json(createTransaction(body), 201);
});
