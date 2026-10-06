import { handle, json } from "@/lib/api";
import { sha1 } from "@/lib/dedupe";
import { getReceiptExtractor } from "@/lib/parsers/receipt";
import { findImportByHash, suggestFor } from "@/lib/queries";

export const runtime = "nodejs";

const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export const POST = handle(async (req: Request) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "ファイルがありません" }, 400);
  if (!TYPES.includes(file.type)) return json({ error: "JPEG/PNG/WebP/GIF画像のみ対応しています" }, 400);
  if (file.size > 8 * 1024 * 1024) return json({ error: "8MB以下の画像を選択してください" }, 400);
  const buf = Buffer.from(await file.arrayBuffer());
  const result = await getReceiptExtractor().extract(buf, file.type, file.name);
  const fileHash = sha1(buf);
  const prior = findImportByHash(fileHash);
  const text = [result.merchant, ...result.items.map((i) => i.name)].filter(Boolean).join(" ");
  return json({
    filename: file.name,
    fileHash,
    alreadyImported: prior ? { createdAt: prior.createdAt, rowCount: prior.rowCount } : null,
    receipt: result,
    suggestedCategoryId: suggestFor(text)?.categoryId ?? null,
  });
});
