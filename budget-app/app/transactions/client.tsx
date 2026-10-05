"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, Receipt, FileText, Pencil } from "lucide-react";
import { Button, Card, ErrorNote, Input, Select } from "@/components/ui";
import { CategoryOptions, useCategories } from "@/components/use-categories";
import { QuickEntry } from "@/components/quick-entry";
import { api, yen } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/defaults";

type Row = {
  id: number; date: string; amount: number; categoryId: number | null; categoryName: string | null;
  color: string | null; paymentMethod: string; merchant: string; memo: string; items: string | null;
  source: "manual" | "pdf" | "receipt";
};
type Result = { rows: Row[]; total: number; count: number };

const monthNow = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
};

export function TransactionsClient() {
  const cats = useCategories();
  const [f, setF] = useState({ month: "", kind: "", categoryId: "", paymentMethod: "", q: "", from: "", to: "" });
  const [data, setData] = useState<Result | null>(null);
  const [err, setErr] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => setF((p) => ({ ...p, month: monthNow() })), []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const load = useCallback(async () => {
    if (!f.month && !f.from && !f.to) return;
    const p = new URLSearchParams();
    // 期間指定があれば月指定より優先
    if (f.from || f.to) { if (f.from) p.set("from", f.from); if (f.to) p.set("to", f.to); } else p.set("month", f.month);
    for (const k of ["kind", "categoryId", "paymentMethod", "q"] as const) if (f[k]) p.set(k, f[k]);
    try {
      setData(await api<Result>(`/api/transactions?${p}`));
      setErr("");
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [f]);
  useEffect(() => {
    const t = setTimeout(load, f.q ? 150 : 0);
    return () => clearTimeout(t);
  }, [load, f.q]);

  async function patch(id: number, body: Record<string, unknown>) {
    try {
      await api(`/api/transactions/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      await load();
    } catch (e) {
      setErr((e as Error).message);
      await load();
    }
  }
  async function remove(id: number) {
    if (!confirm("この明細を削除しますか?")) return;
    await api(`/api/transactions/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">支出一覧</h1>
      <QuickEntry cats={cats} onSaved={load} />

      <Card className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <Input type="month" aria-label="月" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value, from: "", to: "" })} />
        <Input type="date" aria-label="開始日" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <Input type="date" aria-label="終了日" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <Select aria-label="大分類" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          <option value="">全ての大分類</option><option value="fixed">固定費</option><option value="variable">変動費</option><option value="special">特別費</option>
        </Select>
        <Select aria-label="カテゴリ" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
          <option value="">全カテゴリ</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select aria-label="支払元" value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value })}>
          <option value="">全ての支払元</option>{PAYMENT_METHODS.map((p) => <option key={p}>{p}</option>)}
        </Select>
        <Input ref={searchRef} placeholder="キーワード検索 ( / )" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
      </Card>

      <ErrorNote>{err}</ErrorNote>
      <div className="num flex justify-between text-sm text-muted-foreground">
        <span>{data?.count ?? 0} 件{data && data.count > data.rows.length && `(先頭${data.rows.length}件を表示)`}</span>
        <span>合計 <b className="text-foreground">{yen(data?.total ?? 0)}</b></span>
      </div>

      <ul className="space-y-2 md:hidden">
        {data?.rows.map((r) => (
          <li key={r.id} className="rounded-xl border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <Cell value={r.merchant} onSave={(v) => patch(r.id, { merchant: v })} />
                <Cell value={r.date} type="date" onSave={(v) => v && patch(r.id, { date: v })} />
              </div>
              <div className="w-28 shrink-0">
                <Cell value={String(r.amount)} align="right" display={yen(r.amount)} onSave={(v) => { const n = Number(v.replace(/[,，]/g, "")); if (Number.isInteger(n) && n > 0) patch(r.id, { amount: n }); else setErr("金額は1円以上の整数で入力してください"); }} />
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color ?? "var(--border)" }} />
              <Select className="py-1.5" value={r.categoryId ?? ""} onChange={(e) => patch(r.id, { categoryId: e.target.value ? Number(e.target.value) : null })}><CategoryOptions cats={cats} /></Select>
              <Button variant="ghost" aria-label="削除" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4 text-danger" /></Button>
            </div>
            <p className="mt-1 px-2 text-xs text-muted-foreground">{r.paymentMethod}{r.memo && ` ・ ${r.memo}`}</p>
          </li>
        ))}
        {data && data.rows.length === 0 && <li className="p-8 text-center text-sm text-muted-foreground">該当する明細がありません</li>}
      </ul>

      <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr><th className="p-2">日付</th><th className="p-2">店舗・内容</th><th className="p-2">カテゴリ</th><th className="p-2">支払元</th><th className="p-2">メモ</th><th className="p-2 text-right">金額</th><th className="w-10" /></tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.id} className="border-t hover:bg-muted/40">
                <td className="p-1"><Cell value={r.date} type="date" onSave={(v) => v && patch(r.id, { date: v })} /></td>
                <td className="p-1">
                  <div className="flex items-center gap-1">
                    <Cell value={r.merchant} onSave={(v) => patch(r.id, { merchant: v })} />
                    {r.source === "receipt" && <Receipt className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="レシート取込" />}
                    {r.source === "pdf" && <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="PDF取込" />}
                  </div>
                </td>
                <td className="p-1">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color ?? "var(--border)" }} />
                    <Select className="border-transparent bg-transparent py-1" value={r.categoryId ?? ""} onChange={(e) => patch(r.id, { categoryId: e.target.value ? Number(e.target.value) : null })}>
                      <CategoryOptions cats={cats} />
                    </Select>
                  </div>
                </td>
                <td className="p-1">
                  <Select className="border-transparent bg-transparent py-1" value={r.paymentMethod} onChange={(e) => patch(r.id, { paymentMethod: e.target.value })}>
                    {[...new Set([...PAYMENT_METHODS, r.paymentMethod])].map((p) => <option key={p}>{p}</option>)}
                  </Select>
                </td>
                <td className="p-1"><Cell value={r.memo} onSave={(v) => patch(r.id, { memo: v })} /></td>
                <td className="p-1"><Cell value={String(r.amount)} align="right" display={yen(r.amount)} onSave={(v) => { const n = Number(v.replace(/[,，]/g, "")); if (Number.isInteger(n) && n > 0) patch(r.id, { amount: n }); else setErr("金額は1円以上の整数で入力してください"); }} /></td>
                <td className="p-1"><Button variant="ghost" aria-label="削除" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4 text-danger" /></Button></td>
              </tr>
            ))}
            {data && data.rows.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">該当する明細がありません</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** クリックで編集、Enter/blurで保存、Escで取消のインライン編集セル。 */
function Cell({ value, onSave, type = "text", align, display }: { value: string; onSave: (v: string) => void; type?: string; align?: "right"; display?: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  const finished = useRef(false);
  useEffect(() => setV(value), [value]);
  const done = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    if (save && v !== value) onSave(v.trim());
    else setV(value);
  };
  if (!editing)
    return (
      <button onClick={() => { finished.current = false; setEditing(true); }} className={`group flex w-full items-center gap-1 rounded px-2 py-1 hover:bg-muted ${align === "right" ? "num justify-end" : "text-left"}`}>
        <span className="truncate">{display ?? (value || <span className="text-muted-foreground">—</span>)}</span>
        <Pencil className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-40" />
      </button>
    );
  return (
    <Input autoFocus type={type} value={v} className={`py-1 ${align === "right" ? "text-right" : ""}`} onChange={(e) => setV(e.target.value)} onBlur={() => done(true)}
      onKeyDown={(e) => { if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); }} />
  );
}
