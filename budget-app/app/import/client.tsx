"use client";
import { useCallback, useEffect, useState } from "react";
import { FileText, Image as ImageIcon, Loader2, Upload, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button, Card, ErrorNote, Input, Label, Modal, Select } from "@/components/ui";
import { CategoryOptions, useCategories } from "@/components/use-categories";
import { api, cx, yen, type Category } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/defaults";

type PdfRow = { date: string; merchant: string; amount: number; paymentMethod: string; categoryId: number | null; duplicate: boolean; uncertain?: boolean; include: boolean };
type PdfPreview = { filename: string; fileHash: string; alreadyImported: { createdAt: string; rowCount: number } | null; rows: PdfRow[]; skipped: { raw: string; reason: string }[] };
type ReceiptPreview = {
  filename: string; fileHash: string; alreadyImported: { createdAt: string } | null; suggestedCategoryId: number | null;
  receipt: { date: string | null; merchant: string | null; total: number | null; items: { name: string; price: number }[]; engine: "anthropic" | "mock"; warnings: string[] };
};
type Hist = { id: number; kind: string; filename: string; rowCount: number; skippedCount: number; createdAt: string };

const post = (url: string, body: unknown) => api<{ inserted: number; skipped: number }>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function Dropzone({ icon: Icon, title, hint, accept, busy, onFile }: { icon: typeof Upload; title: string; hint: string; accept: string; busy: boolean; onFile: (f: File) => void }) {
  const [over, setOver] = useState(false);
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      className={cx("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition", over ? "border-primary bg-primary/5" : "hover:bg-muted/50")}
    >
      {busy ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <Icon className="h-8 w-8 text-primary" />}
      <span className="font-semibold">{title}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
      <input type="file" accept={accept} className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </label>
  );
}

export function ImportClient() {
  const cats = useCategories();
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<"pdf" | "receipt" | null>(null);
  const [payment, setPayment] = useState("クレジットカード");
  const [pdf, setPdf] = useState<PdfPreview | null>(null);
  const [rc, setRc] = useState<(ReceiptPreview & { form: { date: string; merchant: string; amount: string; categoryId: string; payment: string }; thumb: string }) | null>(null);
  const [hist, setHist] = useState<Hist[]>([]);
  const loadHist = useCallback(() => { api<Hist[]>("/api/import/history").then(setHist).catch(() => {}); }, []);
  useEffect(loadHist, [loadHist]);

  async function upload(kind: "pdf" | "receipt", file: File) {
    setErr(""); setMsg(""); setBusy(kind);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (kind === "pdf") fd.append("paymentMethod", payment);
      const res = await fetch(`/api/import/${kind}`, { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "取り込みに失敗しました");
      if (kind === "pdf") {
        setPdf({ ...body, rows: body.rows.map((r: Omit<PdfRow, "include">) => ({ ...r, include: !r.duplicate })) });
      } else {
        const r = (body as ReceiptPreview).receipt;
        setRc({
          ...body,
          thumb: URL.createObjectURL(file),
          form: { date: r.date ?? "", merchant: r.merchant ?? "", amount: r.total != null ? String(r.total) : "", categoryId: body.suggestedCategoryId ? String(body.suggestedCategoryId) : "", payment: "現金" },
        });
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function commitPdf() {
    if (!pdf) return;
    const rows = pdf.rows.filter((r) => r.include);
    try {
      const r = await post("/api/import/commit", {
        kind: "pdf", filename: pdf.filename, fileHash: pdf.fileHash,
        rows: rows.map((x) => ({ date: x.date, amount: x.amount, categoryId: x.categoryId, paymentMethod: x.paymentMethod, merchant: x.merchant, memo: "" })),
      });
      setMsg(`${r.inserted}件を登録しました${r.skipped ? `(重複${r.skipped}件はスキップ)` : ""}`);
      setPdf(null); loadHist();
    } catch (e) { setErr((e as Error).message); }
  }

  async function commitReceipt() {
    if (!rc) return;
    const n = Number(rc.form.amount.replace(/[,，]/g, ""));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rc.form.date) || !Number.isInteger(n) || n <= 0) return setErr("日付と合計金額を確認してください");
    try {
      const r = await post("/api/import/commit", {
        kind: "receipt", filename: rc.filename, fileHash: rc.fileHash,
        rows: [{ date: rc.form.date, amount: n, categoryId: rc.form.categoryId ? Number(rc.form.categoryId) : null, paymentMethod: rc.form.payment, merchant: rc.form.merchant, memo: "", items: rc.receipt.items.length ? JSON.stringify(rc.receipt.items) : null }],
      });
      setMsg(r.inserted ? "レシートを登録しました" : "同じ内容の明細が登録済みのためスキップしました");
      setRc(null); setErr(""); loadHist();
    } catch (e) { setErr((e as Error).message); }
  }

  const setRow = (i: number, patch: Partial<PdfRow>) => setPdf((p) => p && { ...p, rows: p.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const selected = pdf?.rows.filter((r) => r.include) ?? [];
  const setForm = (patch: Partial<NonNullable<typeof rc>["form"]>) => setRc((p) => p && { ...p, form: { ...p.form, ...patch } });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">取り込み</h1>
      <ErrorNote>{err}</ErrorNote>
      {msg && <p className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600"><CheckCircle2 className="h-4 w-4" />{msg}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="max-w-56"><Label>この明細の支払元</Label><Select value={payment} onChange={(e) => setPayment(e.target.value)}>{PAYMENT_METHODS.map((p) => <option key={p}>{p}</option>)}</Select></div>
          <Dropzone icon={FileText} title="PDF明細をドロップ" hint="クレジットカード・銀行の明細PDF(テキスト形式)" accept="application/pdf" busy={busy === "pdf"} onFile={(f) => upload("pdf", f)} />
        </div>
        <div className="space-y-2">
          <div className="hidden h-[58px] md:block" />
          <Dropzone icon={ImageIcon} title="レシート画像をドロップ" hint="JPEG / PNG / WebP(8MBまで)" accept="image/jpeg,image/png,image/webp,image/gif" busy={busy === "receipt"} onFile={(f) => upload("receipt", f)} />
        </div>
      </div>

      <Card>
        <p className="mb-2 text-sm font-medium">取り込み履歴</p>
        {hist.length === 0 ? <p className="text-sm text-muted-foreground">まだありません</p> : (
          <ul className="divide-y text-sm">
            {hist.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2 py-2">
                <span className="flex min-w-0 items-center gap-2">{h.kind === "pdf" ? <FileText className="h-4 w-4 shrink-0" /> : <ImageIcon className="h-4 w-4 shrink-0" />}<span className="truncate">{h.filename}</span></span>
                <span className="num shrink-0 text-xs text-muted-foreground">{new Date(h.createdAt).toLocaleString("ja-JP")} ・ {h.rowCount}件{h.skippedCount > 0 && `(重複${h.skippedCount})`}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={!!pdf} onClose={() => setPdf(null)} title="PDF明細の解析結果を確認">
        {pdf && (
          <div className="space-y-3">
            {pdf.alreadyImported && <p className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-600"><AlertTriangle className="h-4 w-4 shrink-0" />同じファイルを {new Date(pdf.alreadyImported.createdAt).toLocaleDateString("ja-JP")} に取り込み済みです。重複行は自動でオフになっています。</p>}
            {pdf.rows.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">明細行を検出できませんでした(スキャン画像のPDFは未対応です)。</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="text-left text-xs text-muted-foreground"><tr><th className="w-8 p-1"><input type="checkbox" aria-label="全選択" checked={selected.length === pdf.rows.length} onChange={(e) => setPdf({ ...pdf, rows: pdf.rows.map((r) => ({ ...r, include: e.target.checked })) })} /></th><th className="p-1">日付</th><th className="p-1">店舗・内容</th><th className="p-1">カテゴリ</th><th className="p-1 text-right">金額</th></tr></thead>
                  <tbody>
                    {pdf.rows.map((r, i) => (
                      <tr key={i} className={cx("border-t", !r.include && "opacity-50", r.uncertain && "bg-amber-500/5")}>
                        <td className="p-1"><input type="checkbox" aria-label="登録対象" checked={r.include} onChange={(e) => setRow(i, { include: e.target.checked })} /></td>
                        <td className="p-1"><Input type="date" className="py-1" value={r.date} onChange={(e) => setRow(i, { date: e.target.value })} /></td>
                        <td className="p-1"><Input className="py-1" value={r.merchant} onChange={(e) => setRow(i, { merchant: e.target.value })} />
                          {r.duplicate && <span className="text-xs text-amber-600">登録済みの明細と重複</span>}
                          {r.uncertain && <span className="text-xs text-amber-600">残高列が混在している可能性あり。金額を確認</span>}</td>
                        <td className="p-1"><Select className="py-1" value={r.categoryId ?? ""} onChange={(e) => setRow(i, { categoryId: e.target.value ? Number(e.target.value) : null })}><CategoryOptions cats={cats} /></Select></td>
                        <td className="p-1"><Input inputMode="numeric" className="num py-1 text-right" value={r.amount} onChange={(e) => setRow(i, { amount: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pdf.skipped.length > 0 && (
              <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">除外した行 {pdf.skipped.length}件</summary>
                <ul className="mt-1 space-y-0.5">{pdf.skipped.map((s, i) => <li key={i}>{s.raw} <i>({s.reason})</i></li>)}</ul></details>
            )}
            <div className="flex items-center justify-between border-t pt-3">
              <span className="num text-sm">{selected.length}件 / 合計 <b>{yen(selected.reduce((s, r) => s + r.amount, 0))}</b></span>
              <div className="flex gap-2"><Button variant="outline" onClick={() => setPdf(null)}>キャンセル</Button><Button onClick={commitPdf} disabled={selected.length === 0 || selected.some((r) => r.amount <= 0)}>{selected.length}件を登録</Button></div>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!rc} onClose={() => setRc(null)} title="レシートの解析結果を確認">
        {rc && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); commitReceipt(); }}>
            {rc.receipt.warnings.map((w) => <p key={w} className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-600"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w}</p>)}
            {rc.alreadyImported && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-600">この画像は取り込み済みです。</p>}
            <div className="grid gap-4 md:grid-cols-[200px_1fr]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={rc.thumb} alt="レシート" className="max-h-72 w-full rounded-lg border object-contain" />
              <div className="grid grid-cols-2 gap-3">
                <div><Label>日付</Label><Input type="date" value={rc.form.date} onChange={(e) => setForm({ date: e.target.value })} required /></div>
                <div><Label>合計金額(円)</Label><Input inputMode="numeric" value={rc.form.amount} onChange={(e) => setForm({ amount: e.target.value })} required /></div>
                <div className="col-span-2"><Label>店舗名</Label><Input value={rc.form.merchant} onChange={(e) => setForm({ merchant: e.target.value })} /></div>
                <div><Label>カテゴリ</Label><Select value={rc.form.categoryId} onChange={(e) => setForm({ categoryId: e.target.value })}><CategoryOptions cats={cats} /></Select></div>
                <div><Label>支払方法</Label><Select value={rc.form.payment} onChange={(e) => setForm({ payment: e.target.value })}>{PAYMENT_METHODS.map((p) => <option key={p}>{p}</option>)}</Select></div>
                {rc.receipt.items.length > 0 && (
                  <div className="col-span-2"><Label>品目</Label>
                    <ul className="num max-h-32 divide-y overflow-auto rounded-lg border text-sm">{rc.receipt.items.map((it, i) => <li key={i} className="flex justify-between px-2 py-1"><span>{it.name}</span><span>{yen(it.price)}</span></li>)}</ul></div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t pt-3"><Button type="button" variant="outline" onClick={() => setRc(null)}>キャンセル</Button><Button type="submit">登録</Button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}
