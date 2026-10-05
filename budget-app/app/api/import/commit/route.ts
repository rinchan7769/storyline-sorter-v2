import { handle, json } from "@/lib/api";
import { commitImport } from "@/lib/queries";
import { commitBody } from "@/lib/schemas";

export const POST = handle(async (req: Request) => {
  const b = commitBody.parse(await req.json());
  return json(commitImport(b), 201);
});
