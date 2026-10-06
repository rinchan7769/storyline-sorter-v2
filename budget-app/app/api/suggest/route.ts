import { handle, json } from "@/lib/api";
import { suggestFor } from "@/lib/queries";

export const GET = handle((req: Request) => {
  const text = new URL(req.url).searchParams.get("text") || "";
  const s = suggestFor(text);
  return json({ categoryId: s?.categoryId ?? null, keyword: s?.keyword ?? null });
});
