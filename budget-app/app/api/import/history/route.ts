import { handle, json } from "@/lib/api";
import { listImports } from "@/lib/queries";

export const GET = handle(() => json(listImports()));
