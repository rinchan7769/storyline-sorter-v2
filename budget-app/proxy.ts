import { NextResponse, type NextRequest } from "next/server";
import { authConfig, COOKIE, verifyToken } from "@/lib/auth";

export default async function proxy(req: NextRequest) {
  const cfg = authConfig();
  if (cfg.disabled) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (cfg.misconfigured) {
    return new NextResponse("APP_PASSWORD が未設定です。サーバーの環境変数を設定してください。", { status: 503 });
  }
  const open = pathname === "/login" || pathname === "/api/auth/login" || pathname === "/manifest.webmanifest" || /^\/(icon|apple-icon).*\.png$/.test(pathname);
  if (open) return NextResponse.next();
  if (await verifyToken(req.cookies.get(COOKIE)?.value, cfg.secret)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
