"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Card, ErrorNote, Input, Label, Select } from "@/components/ui";
import { CategoryOptions } from "@/components/use-categories";
import { api, yen, type Category } from "@/lib/format";
import { KIND_LABEL } from "@/lib/defaults";

type Rule = { id: number; keyword: string; categoryId: number; source: "builtin" | "manual" | "learned"; hitCount: number };
type BudgetRes = { month: string; total: number; categories: { categoryId: number; amount: number }[] };
const JSON_H = { "content-type": "application/json" };

export function SettingsClient() {
  const [cats, setCats] = useState<Category[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [budget, setBudget] = useState<BudgetRes | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [newCat, setNewCat] = useState({ name: "", kind: "variable", color: "#6366f1" });
  const [newRule, setNewRule] = useState({ keyword: "", categoryId: "" });
  const [ruleFilter, setRuleFilter] = useState<"all" | "manual" | "learned" | "builtin">("all");

  const load = useCallback(async () => {
    try {
      const [c, r, b] = await Promise.all([
        api<Category[]>("/api/categories"), api<Rule[]>("/api/rules"), api<BudgetRes>("/api/budgets?month=default"),
      ]);
      setCats(c); setRules(r); setBudget(b);
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setErr(""); setMsg("");
    try { await fn(); if (ok) setMsg(ok); await load(); } catch (e) { setErr((e as Error).message); }
  };
  const saveBudget = (categoryId: number | null, value: string) =>
    run(() => api("/api/budgets", { method: "PUT", headers: JSON_H, body: JSON.stringify({ month: "default", categoryId, amount: Number(value.replace(/[,，]/g, "")) || 0 }) }), "予算を保存しました");
  const catName = (id: number) => cats.find((c) => c.id === id)?.name ?? "?";

  if (!budget) return <p className="text-muted-foreground">{err || "読み込み中…"}</p>;
  const catBudget = (id: number) => budget.categories.find((b) => b.categoryId === id)?.amount ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">設定</h1>
      <ErrorNote>{err}</ErrorNote>
      {msg && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">{msg}</p>}

      <Card>
        <h2 className="mb-1 font-semibold">月間予算</h2>
        <p className="mb-3 text-xs text-muted-foreground">毎月の既定値です(入力欄から外れた時点で保存)。0にすると予算なしになります。</p>
        <div className="max-w-xs">
          <Label>総予算(円)</Label>
          <BudgetInput key={`t${budget.total}`} value={budget.total} onSave={(v) => saveBudget(null, v)} />
        </div>
        <h3 className="mb-2 mt-5 text-sm font-medium">カテゴリ別予算(任意)</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cats.map((c) => (
            <div key={c.id}>
              <Label><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: c.color }} />{c.name}</Label>
              <BudgetInput key={`${c.id}-${catBudget(c.id)}`} value={catBudget(c.id)} onSave={(v) => saveBudget(c.id, v)} />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">カテゴリ</h2>
        <div className="space-y-4">
          {(["fixed", "variable", "special"] as const).map((k) => (
            <div key={k}>
              <p className="mb-1 text-xs font-medium text-muted-foreground">{KIND_LABEL[k]}</p>
              <ul className="flex flex-wrap gap-2">
                {cats.filter((c) => c.kind === k).map((c) => (
                  <li key={c.id} className="flex items-center gap-1 rounded-full border py-1 pl-3 pr-1 text-sm">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />{c.name}
                    <button aria-label={`${c.name}を削除`} className="rounded-full p-1 hover:bg-muted" onClick={() => confirm(`「${c.name}」を削除しますか?明細は未分類に戻ります。`) && run(() => api(`/api/categories/${c.id}`, { method: "DELETE" }))}>
                      <Trash2 className="h-3.5 w-3.5 text-danger" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <form className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4" onSubmit={(e) => { e.preventDefault(); run(async () => { await api("/api/categories", { method: "POST", headers: JSON_H, body: JSON.stringify(newCat) }); setNewCat({ ...newCat, name: "" }); }); }}>
          <div><Label>カテゴリ名</Label><Input value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} required maxLength={30} /></div>
          <div><Label>大分類</Label><Select value={newCat.kind} onChange={(e) => setNewCat({ ...newCat, kind: e.target.value })}><option value="fixed">固定費</option><option value="variable">変動費</option><option value="special">特別費</option></Select></div>
          <div><Label>色</Label><input type="color" aria-label="色" value={newCat.color} onChange={(e) => setNewCat({ ...newCat, color: e.target.value })} className="h-9 w-14 rounded border bg-background" /></div>
          <Button type="submit"><Plus className="h-4 w-4" />追加</Button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">自動分類ルール</h2>
        <p className="mb-3 text-xs text-muted-foreground">店舗名・品目にキーワードが含まれると自動でカテゴリを推測します。優先順位は 手動 &gt; 学習 &gt; 組み込み。明細のカテゴリを手修正すると「学習」ルールが自動で追加されます。</p>
        <form className="mb-4 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); run(async () => { await api("/api/rules", { method: "POST", headers: JSON_H, body: JSON.stringify({ keyword: newRule.keyword, categoryId: Number(newRule.categoryId) }) }); setNewRule({ keyword: "", categoryId: newRule.categoryId }); }, "ルールを追加しました"); }}>
          <div><Label>キーワード</Label><Input value={newRule.keyword} onChange={(e) => setNewRule({ ...newRule, keyword: e.target.value })} required /></div>
          <div><Label>カテゴリ</Label><Select value={newRule.categoryId} onChange={(e) => setNewRule({ ...newRule, categoryId: e.target.value })} required><CategoryOptions cats={cats} /></Select></div>
          <Button type="submit" disabled={!newRule.categoryId}><Plus className="h-4 w-4" />追加</Button>
        </form>
        <div className="mb-2 flex gap-1 text-xs">
          {(["all", "manual", "learned", "builtin"] as const).map((k) => (
            <button key={k} onClick={() => setRuleFilter(k)} className={`rounded-full border px-3 py-1 ${ruleFilter === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              {{ all: "すべて", manual: "手動", learned: "学習", builtin: "組み込み" }[k]}
            </button>
          ))}
        </div>
        <ul className="max-h-80 divide-y overflow-auto text-sm">
          {rules.filter((r) => ruleFilter === "all" || r.source === ruleFilter).map((r) => (
            <li key={r.id} className="flex items-center justify-between py-1.5">
              <span><b>{r.keyword}</b> <span className="text-muted-foreground">→ {catName(r.categoryId)}</span> <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs">{{ builtin: "組み込み", manual: "手動", learned: "学習" }[r.source]}</span></span>
              <Button variant="ghost" aria-label="ルールを削除" onClick={() => run(() => api(`/api/rules/${r.id}`, { method: "DELETE" }))}><Trash2 className="h-4 w-4 text-danger" /></Button>
            </li>
          ))}
        </ul>
      </Card>
      <p className="text-xs text-muted-foreground">既定の総予算: {yen(budget.total)}</p>
    </div>
  );
}

function BudgetInput({ value, onSave }: { value: number; onSave: (v: string) => void }) {
  const [v, setV] = useState(String(value));
  return <Input inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== String(value) && onSave(v)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />;
}
