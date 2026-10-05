export type Rule = { keyword: string; categoryId: number; source: "builtin" | "manual" | "learned" };

export function normalize(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** 学習ルールのキーとして使う店舗名の正規化(法人格・末尾の店舗番号を除去)。 */
export function merchantKey(merchant: string): string {
  return normalize(merchant)
    .replace(/(株式会社|有限会社|\(株\)|㈱)/g, "")
    .replace(/[\s\-‐ー]*\d+$/, "")
    .trim();
}

const PRIORITY = { manual: 3, learned: 2, builtin: 1 } as const;

function matches(haystack: string, keyword: string): boolean {
  if (!keyword) return false;
  // 短い英数字キーワード(au, jr 等)は単語境界で一致させ、誤爆を防ぐ
  if (/^[a-z0-9]{1,3}$/.test(keyword)) {
    return new RegExp(`(^|[^a-z0-9])${keyword}($|[^a-z0-9])`).test(haystack);
  }
  return haystack.includes(keyword);
}

/** 店舗名・品目・メモからカテゴリを推測する。手動>学習>組み込みの順、同順位なら長いキーワード優先。 */
export function suggestCategory(
  text: string,
  rules: Rule[],
): { categoryId: number; keyword: string; source: Rule["source"] } | null {
  const hay = normalize(text);
  if (!hay) return null;
  let best: Rule | null = null;
  for (const r of rules) {
    const kw = normalize(r.keyword);
    if (!matches(hay, kw)) continue;
    if (
      !best ||
      PRIORITY[r.source] > PRIORITY[best.source] ||
      (PRIORITY[r.source] === PRIORITY[best.source] && kw.length > normalize(best.keyword).length)
    ) {
      best = r;
    }
  }
  return best ? { categoryId: best.categoryId, keyword: best.keyword, source: best.source } : null;
}
