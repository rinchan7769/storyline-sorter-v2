import { handle, json } from "@/lib/api";
import { getDashboard } from "@/lib/queries";
import { currentMonth } from "@/lib/date";

export const GET = handle((req: Request) => {
  const month = new URL(req.url).searchParams.get("month") || currentMonth();
  return json(getDashboard(month));
});
