"use client";
import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button, ErrorNote, Input, Label, Select } from "@/components/ui";
import { CategoryOptions } from "@/components/use-categories";
import { api, type Category } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/defaults";

const today = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};

export function QuickEntry({ cats, onSaved }: { cats: Category[]; onSaved: () => void }) {
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [touchedCat, setTouchedCat] = useState(false);
  const [payment, setPayment] = useState(PAYMENT_METHODS[0]);
  const [merchant, setMerchant] = useState("");
  const [memo, setMemo] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDate(today()), []);
  // ショートカット: n = 金額入力へ移動
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) {
        e.preventDefault();
        amountRef.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  async function suggest() {
    if (touchedCat || !merchant.trim()) return;
    const s = await api<{ categoryId: number | null }>(`/api/suggest?text=${encodeURIComponent(merchant)}`).catch(() => null);
    if (s?.categoryId) setCategoryId(String(s.categoryId));
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setErr("");
    const n = Number(amount.replace(/[,，]/g, ""));
    if (!Number.isInteger(n) || n <= 0) return setErr("金額は1円以上の整数で入力してください");
    setBusy(true);
    try {
      await api("/api/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date, amount: n, categoryId: categoryId ? Number(categoryId) : null, paymentMethod: payment, merchant: merchant.trim(), memo: memo.trim() }),
      });
      setAmount(""); setMerchant(""); setMemo(""); setCategoryId(""); setTouchedCat(false);
      amountRef.current?.focus();
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && submit()}
      className="space-y-3 rounded-xl border bg-card p-4"
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <div><Label>日付</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
        <div><Label>金額(円)</Label><Input ref={amountRef} inputMode="numeric" placeholder="1,200" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
        <div className="md:col-span-2"><Label>店舗・内容</Label><Input value={merchant} onChange={(e) => setMerchant(e.target.value)} onBlur={suggest} placeholder="スーパー○○" /></div>
        <div>
          <Label>カテゴリ</Label>
          <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setTouchedCat(true); }}><CategoryOptions cats={cats} /></Select>
        </div>
        <div><Label>支払方法</Label><Select value={payment} onChange={(e) => setPayment(e.target.value)}>{PAYMENT_METHODS.map((p) => <option key={p}>{p}</option>)}</Select></div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1"><Label>メモ</Label><Input value={memo} onChange={(e) => setMemo(e.target.value)} /></div>
        <Button type="submit" disabled={busy}><Plus className="h-4 w-4" />追加</Button>
      </div>
      <p className="text-xs text-muted-foreground">ショートカット: <kbd>n</kbd> 金額へ移動 ・ <kbd>Ctrl/⌘ + Enter</kbd> 保存 ・ <kbd>/</kbd> 検索</p>
      <ErrorNote>{err}</ErrorNote>
    </form>
  );
}
