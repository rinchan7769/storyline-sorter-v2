import { eq } from "drizzle-orm";
import { handle, json } from "@/lib/api";
import { getDb } from "@/lib/db";
import { categoryRules } from "@/lib/db/schema";

export const DELETE = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  getDb().delete(categoryRules).where(eq(categoryRules.id, Number((await params).id))).run();
  return json({ ok: true });
});
