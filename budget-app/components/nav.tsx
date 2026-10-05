"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { LayoutDashboard, List, Upload, Settings, Moon, Sun, Wallet, LogOut } from "lucide-react";
import { cx } from "@/lib/format";

const items = [
  { href: "/dashboard", label: "ダッシュボード", icon: LayoutDashboard },
  { href: "/transactions", label: "支出一覧", icon: List },
  { href: "/import", label: "取り込み", icon: Upload },
  { href: "/settings", label: "設定", icon: Settings },
];

export function Nav() {
  const path = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (path === "/login") return null;
  return (
    <header className="sticky top-0 z-40 border-b bg-card/90 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2">
        <Link href="/dashboard" className="mr-4 flex items-center gap-2 font-bold">
          <Wallet className="h-5 w-5 text-primary" /> 家計簿
        </Link>
        <nav className="flex flex-1 gap-1 overflow-x-auto">
          {items.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cx(
                "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm",
                path.startsWith(href) ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted",
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          ))}
        </nav>
        <button
          aria-label="テーマ切替"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="rounded-lg p-2 hover:bg-muted"
        >
          {mounted && resolvedTheme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>
        <button
          aria-label="ログアウト"
          onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }}
          className="rounded-lg p-2 hover:bg-muted"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
