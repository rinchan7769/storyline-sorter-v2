import { z } from "zod";
import { handle, json } from "@/lib/api";
import { getDb } from "@/lib/db";
import { categories } from "@/lib/db/schema";
import { listCategories } from "@/lib/queries";

export const GET = handle(() => json(listCategories()));

const body = z.object({
  name: z.string().min(1).max(30),
  kind: z.enum(["fixed", "variable", "special"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6366f1"),
});

export const POST = handle(async (req: Request) => {
  const b = body.parse(await req.json());
  const db = getDb();
  const max = Math.max(0, ...listCategories(db).map((c) => c.sortOrder));
  try {
    return json(db.insert(categories).values({ ...b, sortOrder: max + 1 }).returning().get(), 201);
  } catch {
    return json({ error: "同名のカテゴリが既にあります" }, 409);
  }
});
