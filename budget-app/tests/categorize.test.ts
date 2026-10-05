import { describe, expect, it } from "vitest";
import { merchantKey, suggestCategory, type Rule } from "@/lib/categorize";

const rules: Rule[] = [
  { keyword: "セブン", categoryId: 1, source: "builtin" },
  { keyword: "セブン銀行", categoryId: 9, source: "builtin" },
  { keyword: "au", categoryId: 2, source: "builtin" },
  { keyword: "スタバ", categoryId: 3, source: "builtin" },
  { keyword: "スタバ", categoryId: 4, source: "manual" },
];

describe("suggestCategory", () => {
  it("全角半角・大文字小文字を吸収して一致する", () => {
    expect(suggestCategory("ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ", rules)?.categoryId).toBe(1); // 半角カナもNFKCで一致
    expect(suggestCategory("セブン-イレブン 渋谷店", rules)?.categoryId).toBe(1);
  });
  it("同順位なら長いキーワードを優先", () => {
    expect(suggestCategory("セブン銀行 ATM", rules)?.categoryId).toBe(9);
  });
  it("短い英字は単語境界でのみ一致", () => {
    expect(suggestCategory("TOKYO AUTO", rules)).toBeNull();
    expect(suggestCategory("au 料金", rules)?.categoryId).toBe(2);
  });
  it("手動ルールが組み込みルールに勝つ", () => {
    expect(suggestCategory("スタバ 新宿", rules)?.categoryId).toBe(4);
  });
});

describe("merchantKey", () => {
  it("法人格と末尾の店舗番号を除く", () => {
    expect(merchantKey("株式会社ABC商店 012")).toBe("abc商店");
  });
});
