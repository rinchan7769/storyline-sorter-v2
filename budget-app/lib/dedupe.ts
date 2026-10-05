import crypto from "node:crypto";
import { normalize } from "./categorize";

export function sha1(input: string | Buffer): string {
  return crypto.createHash("sha1").update(input).digest("hex");
}

export type HashInput = { date: string; amount: number; merchant: string; paymentMethod: string };

/**
 * 明細行の重複判定ハッシュ。同一ファイル内に同日・同額・同店舗の正当な複数明細があり得るため、
 * 出現順の連番(occurrence)を含める。再取り込み時は同じ連番になるのでスキップされる。
 */
export function rowHash(r: HashInput, occurrence: number, salt = ""): string {
  return sha1([salt, r.date, r.amount, normalize(r.merchant), r.paymentMethod, occurrence].join("|"));
}

/** 行配列に対して occurrence を数えながらハッシュを付与する。 */
/** salt はレシート画像のように「ファイル単位で別物」とみなしたい場合に指定する。 */
export function hashRows<T extends HashInput>(rows: T[], salt = ""): (T & { dedupeHash: string })[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = [r.date, r.amount, normalize(r.merchant), r.paymentMethod].join("|");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { ...r, dedupeHash: rowHash(r, n, salt) };
  });
}
