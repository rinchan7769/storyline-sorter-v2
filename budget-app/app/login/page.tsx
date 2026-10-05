"use client";
import { useState } from "react";
import { Wallet } from "lucide-react";
import { Button, ErrorNote, Input } from "@/components/ui";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    if (res.ok) {
      window.location.href = "/dashboard";
      return;
    }
    setErr((await res.json().catch(() => ({}))).error || "ログインに失敗しました");
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-16 max-w-sm space-y-4 rounded-xl border bg-card p-6 shadow-sm">
      <h1 className="flex items-center gap-2 text-lg font-bold"><Wallet className="h-5 w-5 text-primary" />家計簿にログイン</h1>
      <Input type="password" autoComplete="current-password" autoFocus placeholder="パスワード" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <ErrorNote>{err}</ErrorNote>
      <Button type="submit" disabled={busy} className="w-full">ログイン</Button>
    </form>
  );
}
