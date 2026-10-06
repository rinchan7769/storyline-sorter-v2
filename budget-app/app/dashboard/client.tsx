"use client";
import { useEffect, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ChevronLeft, ChevronRight, ArrowLeft, TrendingDown, TrendingUp } from "lucide-react";
import { Button, Card, Progress, ErrorNote } from "@/components/ui";
import { api, pct, yen } from "@/lib/format";
import { KIND_COLOR, KIND_LABEL } from "@/lib/defaults";

type Dash = {
  month: string; total: number; count: number;
  byKind: Record<"fixed" | "variable" | "special", number>;
  categories: { id: number | null; name: string; color: string; amount: number; details: { name: string; amount: number; count: number }[] }[];
  daily: { day: number; amount: number; cumulative: number | null; prevCumulative: number }[];
  prevSamePeriod: number; prevTotal: number;
  budget: { total: number; remaining: number };
  categoryBudgets: { id: number; name: string; color: string; budget: number; spent: number }[];
  daysLeft: number;
};

const shift = (m: string, d: number) => {
  const [y, mo] = m.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1 + d, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
};
const tipStyle = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--foreground)" };

export function DashboardClient() {
  const [month, setMonth] = useState<string | null>(null);
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState("");
  const [drill, setDrill] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    const n = new Date();
    setMonth(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`);
  }, []);
  useEffect(() => {
    if (!month) return;
    setDrill(undefined);
    api<Dash>(`/api/dashboard?month=${month}`).then(setD).catch((e) => setErr(e.message));
  }, [month]);

  if (!month || !d) return <p className="text-muted-foreground">{err || "読み込み中…"}</p>;

  const used = pct(d.total, d.budget.total);
  const over = d.budget.total > 0 && d.budget.remaining < 0;
  const perDay = d.daysLeft > 0 && d.budget.remaining > 0 ? Math.floor(d.budget.remaining / d.daysLeft) : 0;
  const diff = d.total - d.prevSamePeriod;
  const drillCat = drill !== undefined ? d.categories.find((c) => c.id === drill) : undefined;
  type Slice = { name: string; value: number; color: string; opacity: number; id?: number | null };
  const pieData: Slice[] = drillCat
    ? drillCat.details.map((x, i) => ({ name: x.name, value: x.amount, color: drillCat.color, opacity: Math.max(0.35, 1 - i * 0.1) }))
    : d.categories.map((c) => ({ name: c.name, value: c.amount, color: c.color, opacity: 1, id: c.id }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="outline" aria-label="前月" onClick={() => setMonth(shift(month, -1))}><ChevronLeft className="h-4 w-4" /></Button>
        <h1 className="num min-w-32 text-center text-xl font-bold">{month.replace("-", "年")}月</h1>
        <Button variant="outline" aria-label="翌月" onClick={() => setMonth(shift(month, 1))}><ChevronRight className="h-4 w-4" /></Button>
      </div>
      <ErrorNote>{err}</ErrorNote>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <p className="text-sm text-muted-foreground">今月の総支出</p>
          <p className="num mt-1 text-3xl font-bold">{yen(d.total)}</p>
          <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
            {diff > 0 ? <TrendingUp className="h-4 w-4 text-danger" /> : <TrendingDown className="h-4 w-4 text-emerald-500" />}
            前月同期比 {diff >= 0 ? "+" : "−"}{yen(Math.abs(diff))}
          </p>
        </Card>
        <Card className="md:col-span-2">
          {d.budget.total > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">今月の予算 {yen(d.budget.total)}</p>
              <p className={`num mt-1 text-2xl font-bold ${over ? "text-danger" : ""}`}>
                {over ? `${yen(-d.budget.remaining)} オーバー` : `あと ${yen(d.budget.remaining)} 使えます`}
              </p>
              <div className="my-3"><Progress value={used} over={over} /></div>
              <p className="num text-xs text-muted-foreground">
                消化率 {used}%{perDay > 0 && ` ・ 残り${d.daysLeft}日 / 1日あたり ${yen(perDay)}`}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">予算が未設定です。<a className="text-primary underline" href="/settings">設定</a>から月間予算を登録してください。</p>
          )}
        </Card>
      </div>

      <Card>
        <p className="mb-3 text-sm font-medium">固定費 / 変動費 / 特別費の構成比</p>
        <div className="flex h-5 w-full overflow-hidden rounded-full bg-muted">
          {(["fixed", "variable", "special"] as const).map((k) => (
            <div key={k} style={{ width: `${pct(d.byKind[k], d.total)}%`, background: KIND_COLOR[k] }} title={KIND_LABEL[k]} />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          {(["fixed", "variable", "special"] as const).map((k) => (
            <div key={k}>
              <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: KIND_COLOR[k] }} />
              {KIND_LABEL[k]}
              <p className="num font-semibold">{yen(d.byKind[k])} <span className="text-xs font-normal text-muted-foreground">({pct(d.byKind[k], d.total)}%)</span></p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">{drillCat ? `${drillCat.name} の内訳(店舗別)` : "カテゴリ別支出(クリックで内訳)"}</p>
            {drillCat && <Button variant="ghost" onClick={() => setDrill(undefined)}><ArrowLeft className="h-4 w-4" />戻る</Button>}
          </div>
          {pieData.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">この月の支出はありません</p>
          ) : (
            <div className="h-72">
              <ResponsiveContainer>
                <PieChart>
                  <Pie isAnimationActive={false} data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={100} paddingAngle={1}
                    onClick={(d: unknown) => {
                      const x = d as { id?: number | null; payload?: Slice };
                      const id = x.payload?.id !== undefined ? x.payload.id : x.id;
                      if (!drillCat && id !== undefined) setDrill(id);
                    }}>
                    {pieData.map((e, i) => (
                      <Cell key={i} fill={e.color} fillOpacity={e.opacity} cursor={drillCat ? "default" : "pointer"} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => yen(Number(v))} contentStyle={tipStyle} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <ul className="num mt-2 divide-y text-sm">
            {(drillCat ? drillCat.details.map((x) => ({ key: x.name, name: `${x.name}(${x.count}件)`, amount: x.amount, id: undefined as number | null | undefined })) : d.categories.map((c) => ({ key: String(c.id), name: c.name, amount: c.amount, id: c.id }))).map((r) => (
              <li key={r.key}>
                <button disabled={!!drillCat} onClick={() => r.id !== undefined && setDrill(r.id)} className="flex w-full justify-between py-1.5 text-left enabled:hover:text-primary">
                  <span>{r.name}</span><span>{yen(r.amount)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <p className="mb-2 text-sm font-medium">日別支出</p>
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={d.daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${v / 1000}k`} width={40} />
                <Tooltip formatter={(v) => yen(Number(v))} labelFormatter={(l) => `${l}日`} contentStyle={tipStyle} />
                <Bar isAnimationActive={false} dataKey="amount" name="支出" fill="var(--primary)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card>
        <p className="mb-1 text-sm font-medium">累計支出の前月比較</p>
        <p className="mb-2 text-xs text-muted-foreground">前月は月末まで {yen(d.prevTotal)}</p>
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={d.daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${v / 1000}k`} width={40} />
              <Tooltip formatter={(v) => yen(Number(v))} labelFormatter={(l) => `${l}日`} contentStyle={tipStyle} />
              <Legend />
              <Line isAnimationActive={false} type="monotone" dataKey="cumulative" name="今月" stroke="var(--primary)" strokeWidth={2.5} dot={false} connectNulls={false} />
              <Line isAnimationActive={false} type="monotone" dataKey="prevCumulative" name="前月" stroke="var(--muted-foreground)" strokeDasharray="5 4" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {d.categoryBudgets.length > 0 && (
        <Card>
          <p className="mb-3 text-sm font-medium">カテゴリ別予算</p>
          <div className="space-y-3">
            {d.categoryBudgets.map((c) => (
              <div key={c.id}>
                <div className="num mb-1 flex justify-between text-sm">
                  <span>{c.name}</span>
                  <span className={c.spent > c.budget ? "text-danger" : "text-muted-foreground"}>{yen(c.spent)} / {yen(c.budget)}</span>
                </div>
                <Progress value={pct(c.spent, c.budget)} color={c.color} over={c.spent > c.budget} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
