import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { Nav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = { title: "家計簿", description: "固定費・変動費を可視化する家計簿アプリ" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Nav />
          <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
