/**
 * レシート抽出インターフェース。ANTHROPIC_API_KEY があればLLMビジョンで抽出し、
 * 無ければモック抽出器(サンプル値を返す)にフォールバックする。
 * 別のOCR/LLMを使う場合は ReceiptExtractor を実装して getReceiptExtractor に差し込む。
 */
import { todayYmd } from "../date";

export type ReceiptItem = { name: string; price: number };
export type ReceiptResult = {
  date: string | null; // YYYY-MM-DD
  merchant: string | null;
  total: number | null;
  items: ReceiptItem[];
  engine: "anthropic" | "mock";
  warnings: string[];
};

export interface ReceiptExtractor {
  extract(image: Buffer, mediaType: string, filename: string): Promise<ReceiptResult>;
}

const PROMPT = `これは日本のレシート画像です。次のJSONのみを出力してください(説明文・コードフェンス不要)。
{"date":"YYYY-MM-DD","merchant":"店舗名","total":合計金額(税込・整数),"items":[{"name":"品目","price":金額(整数)}]}
読み取れない項目は null、品目が読めなければ空配列にしてください。`;

export function parseReceiptJson(text: string): Omit<ReceiptResult, "engine" | "warnings"> {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("抽出結果をJSONとして解釈できませんでした");
  const j = JSON.parse(m[0]);
  const toInt = (v: unknown) => (typeof v === "number" && isFinite(v) ? Math.round(v) : null);
  const date = typeof j.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.date) ? j.date : null;
  const items: ReceiptItem[] = Array.isArray(j.items)
    ? j.items
        .map((i: { name?: unknown; price?: unknown }) => ({ name: String(i?.name ?? ""), price: toInt(i?.price) ?? 0 }))
        .filter((i: ReceiptItem) => i.name)
    : [];
  return {
    date,
    merchant: typeof j.merchant === "string" && j.merchant ? j.merchant : null,
    total: toInt(j.total),
    items,
  };
}

class AnthropicExtractor implements ReceiptExtractor {
  constructor(private apiKey: string, private model: string) {}
  async extract(image: Buffer, mediaType: string): Promise<ReceiptResult> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: image.toString("base64") } },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`ビジョンAPIエラー (${res.status})`);
    const body = await res.json();
    const text: string = body.content?.find((c: { type: string }) => c.type === "text")?.text ?? "";
    const parsed = parseReceiptJson(text);
    const warnings: string[] = [];
    if (!parsed.date) warnings.push("日付を読み取れませんでした");
    if (!parsed.merchant) warnings.push("店舗名を読み取れませんでした");
    if (parsed.total == null) warnings.push("合計金額を読み取れませんでした");
    return { ...parsed, engine: "anthropic", warnings };
  }
}

class MockExtractor implements ReceiptExtractor {
  async extract(_img: Buffer, _type: string, filename: string): Promise<ReceiptResult> {
    const m = filename.match(/(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})/);
    const date = m ? `${m[1]}-${m[2]}-${m[3]}` : todayYmd();
    return {
      date,
      merchant: "サンプルスーパー 渋谷店",
      total: 1480,
      items: [
        { name: "牛乳", price: 218 },
        { name: "食パン", price: 168 },
        { name: "鶏もも肉", price: 498 },
        { name: "トマト", price: 298 },
        { name: "ヨーグルト", price: 298 },
      ],
      engine: "mock",
      warnings: ["OCR未設定のためサンプル値を表示しています。内容を必ず修正してください(ANTHROPIC_API_KEY を設定すると自動抽出されます)"],
    };
  }
}

export function getReceiptExtractor(): ReceiptExtractor {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) return new AnthropicExtractor(key, process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5");
  return new MockExtractor();
}
