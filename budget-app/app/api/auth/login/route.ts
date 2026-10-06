import { NextResponse } from "next/server";
import { authConfig, checkPassword, COOKIE, createToken, MAX_AGE } from "@/lib/auth";

// 総当たり対策: 同一IPで5回失敗したら15分ロック(単一プロセス内メモリ)
const fails = new Map<string, { n: number; until: number }>();

export async function POST(req: Request) {
  const cfg = authConfig();
  if (cfg.misconfigured) return NextResponse.json({ error: "APP_PASSWORD が未設定です" }, { status: 503 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const f = fails.get(ip);
  if (f && f.n >= 5 && f.until > Date.now()) {
    return NextResponse.json({ error: "試行回数が多すぎます。しばらくしてから再試行してください" }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  if (cfg.disabled || !(await checkPassword(String(body.password ?? ""), cfg.password))) {
    fails.set(ip, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 15 * 60 * 1000 });
    return NextResponse.json({ error: "パスワードが違います" }, { status: 401 });
  }
  fails.delete(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, await createToken(cfg.secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true" || (process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false"),
    path: "/",
    maxAge: MAX_AGE,
  });
  return res;
}
