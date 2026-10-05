import { handle, json } from "@/lib/api";
import { sha1 } from "@/lib/dedupe";
import { parsePdfStatement } from "@/lib/parsers/pdf";
import { annotateRows, findImportByHash } from "@/lib/queries";

export const runtime = "nodejs";

export const POST = handle(async (req: Request) => {
  const form = await req.formData();
  const file = form.get("file");
  const paymentMethod = String(form.get("paymentMethod") || "クレジットカード");
  if (!(file instanceof File)) return json({ error: "ファイルがありません" }, 400);
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.subarray(0, 5).toString() !== "%PDF-") return json({ error: "PDFファイルではありません" }, 400);
  let parsed;
  try {
    parsed = await parsePdfStatement(buf);
  } catch {
    return json({ error: "PDFを解析できませんでした(パスワード保護や画像のみのPDFは未対応です)" }, 422);
  }
  const fileHash = sha1(buf);
  const prior = findImportByHash(fileHash);
  return json({
    filename: file.name,
    fileHash,
    alreadyImported: prior ? { createdAt: prior.createdAt, rowCount: prior.rowCount } : null,
    rows: annotateRows(parsed.rows, paymentMethod),
    skipped: parsed.skipped,
  });
});
