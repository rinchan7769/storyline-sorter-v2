export const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;
export const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `通信エラー (${res.status})`);
  return body as T;
}
export type Category = { id: number; name: string; kind: "fixed" | "variable" | "special"; color: string; sortOrder: number };
