import { describe, expect, it } from "vitest";
import { parseStatementText } from "@/lib/parsers/statement";

const today = new Date("2025-10-05T00:00:00+09:00");

describe("parseStatementText", () => {
  it("年付き・年なし・和暦表記の日付と金額を読む", () => {
    const text = [
      "ご利用明細",
      "2025/09/03 セブン-イレブン 渋谷店 1,234",
      "09/05 AMAZON.CO.JP 3,980",
      "2025年9月10日 ○○ガス 12,000円",
    ].join("\n");
    const { rows } = parseStatementText(text, today);
    expect(rows.map((r) => [r.date, r.merchant, r.amount])).toEqual([
      ["2025-09-03", "セブン-イレブン 渋谷店", 1234],
      ["2025-09-05", "AMAZON.CO.JP", 3980],
      ["2025-09-10", "○○ガス", 12000],
    ]);
  });
  it("未来月になる月日表記は前年とみなす", () => {
    const { rows } = parseStatementText("12/24 ケーキ屋 4,000", today);
    expect(rows[0].date).toBe("2024-12-24");
  });
  it("集計行・入金・マイナス金額は除外する", () => {
    const text = ["2025/09/30 お支払金額合計 50,000", "2025/09/25 給与 振込 300,000", "2025/09/26 返品 -1,000"].join("\n");
    const { rows, skipped } = parseStatementText(text, today);
    expect(rows).toHaveLength(0);
    expect(skipped).toHaveLength(3);
  });
  it("銀行明細は末尾を残高とみなし要確認にする", () => {
    const { rows } = parseStatementText("2025/09/27 カード引落 45,000 123,456", today);
    expect(rows[0]).toMatchObject({ amount: 45000, uncertain: true });
  });
  it("利用日・支払日の併記を読み飛ばす", () => {
    const { rows } = parseStatementText("2025/09/01 2025/10/27 スターバックス 650", today);
    expect(rows[0]).toMatchObject({ date: "2025-09-01", merchant: "スターバックス" });
  });
});
