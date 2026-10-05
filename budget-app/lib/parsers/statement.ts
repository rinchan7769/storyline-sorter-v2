export type ParsedRow = {
  date: string; // YYYY-MM-DD
  merchant: string;
  amount: number;
  /** 残高列らしき数値が混在するなど、確認が必要な行 */
  uncertain: boolean;
  raw: string;
};

export type StatementParseResult = { rows: ParsedRow[]; skipped: { raw: string; reason: string }[] };

const SKIP_WORDS = /(残高|合計|小計|繰越|ご利用代金|お支払(い)?金額|請求(金額|額)|ポイント|ページ)/;
const INCOME_WORDS = /(給与|賞与|入金|利息|返金|キャンセル|還付)/;
const AMOUNT_TOKEN = /^[-−▲△]?\d[\d,]*円?$/;

function pad(n: number | string) {
  return String(n).padStart(2, "0");
}

function validDate(y: number, m: number, d: number) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 行頭の日付を読み取る。年がない場合は defaultYear(未来月になる場合は前年)を使う。 */
export function extractLeadingDate(
  line: string,
  today: Date,
): { date: string; rest: string } | null {
  const full = line.match(/^\s*(\d{4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})\s*日?/);
  if (full) {
    const [, y, m, d] = full;
    if (!validDate(+y, +m, +d)) return null;
    return { date: `${y}-${pad(m)}-${pad(d)}`, rest: line.slice(full[0].length) };
  }
  const short = line.match(/^\s*(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*日?(?=\s)/);
  if (short) {
    const [, m, d] = short;
    let y = today.getFullYear();
    if (+m > today.getMonth() + 1) y -= 1;
    if (!validDate(y, +m, +d)) return null;
    return { date: `${y}-${pad(m)}-${pad(d)}`, rest: line.slice(short[0].length) };
  }
  return null;
}

function toAmount(tok: string): number {
  const neg = /^[-−▲△]/.test(tok);
  const n = parseInt(tok.replace(/[^\d]/g, ""), 10);
  return neg ? -n : n;
}

/** PDFから抽出したテキストを明細行にパースする(クレジットカード/銀行明細共通のヒューリスティック)。 */
export function parseStatementText(text: string, today = new Date()): StatementParseResult {
  const rows: ParsedRow[] = [];
  const skipped: { raw: string; reason: string }[] = [];

  for (const rawLine of text.normalize("NFKC").split(/\r?\n/)) {
    const line = rawLine.replace(/[\t　]+/g, " ").trim();
    if (!line) continue;
    const lead = extractLeadingDate(line, today);
    if (!lead) continue;

    // 2つ目の日付(利用日/支払日の併記)を読み飛ばす
    let rest = lead.rest.trim();
    const second = extractLeadingDate(rest, today);
    if (second) rest = second.rest.trim();

    if (SKIP_WORDS.test(rest)) {
      skipped.push({ raw: line, reason: "集計・残高行" });
      continue;
    }

    const tokens = rest.split(/\s+/).filter(Boolean);
    const nums: string[] = [];
    while (tokens.length && AMOUNT_TOKEN.test(tokens[tokens.length - 1])) nums.unshift(tokens.pop()!);
    if (!nums.length) {
      skipped.push({ raw: line, reason: "金額なし" });
      continue;
    }
    const merchant = tokens.join(" ").trim();
    if (!merchant) {
      skipped.push({ raw: line, reason: "摘要なし" });
      continue;
    }

    // 数値が複数ある場合: 末尾は残高とみなし、その直前を金額にする(要確認)
    const uncertain = nums.length >= 2;
    const amount = toAmount(uncertain ? nums[nums.length - 2] : nums[0]);
    if (amount <= 0 || INCOME_WORDS.test(merchant)) {
      skipped.push({ raw: line, reason: "収入・返金など支出以外" });
      continue;
    }
    rows.push({ date: lead.date, merchant, amount, uncertain, raw: line });
  }
  return { rows, skipped };
}
