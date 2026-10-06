import { z } from "zod";
import { handle, json } from "@/lib/api";
import { getDb } from "@/lib/db";
import { categoryRules } from "@/lib/db/schema";
import { normalize } from "@/lib/categorize";
import { listRules } from "@/lib/queries";

export const GET = handle(() => json(listRules()));

const body = z.object({ keyword: z.string().min(1).max(60), categoryId: z.number().int() });

export const POST = handle(async (req: Request) => {
  const b = body.parse(await req.json());
  const keyword = normalize(b.keyword);
  const row = getDb()
    .insert(categoryRules)
    .values({ keyword, categoryId: b.categoryId, source: "manual" })
    .onConflictDoUpdate({ target: categoryRules.keyword, set: { categoryId: b.categoryId, source: "manual" } })
    .returning()
    .get();
  return json(row, 201);
});
