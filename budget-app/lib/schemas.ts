import { z } from "zod";

export const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD形式で入力してください");
export const month = z.string().regex(/^\d{4}-\d{2}$/);

export const txInput = z.object({
  date: ymd,
  amount: z.number().int().positive("金額は1円以上の整数"),
  categoryId: z.number().int().nullable(),
  paymentMethod: z.string().min(1).default("現金"),
  merchant: z.string().default(""),
  memo: z.string().default(""),
});
export const txPatch = txInput.partial();

export const commitBody = z.object({
  kind: z.enum(["pdf", "receipt"]),
  filename: z.string(),
  fileHash: z.string(),
  rows: z
    .array(txInput.extend({ items: z.string().nullable().optional() }))
    .min(1, "登録する明細がありません"),
});
