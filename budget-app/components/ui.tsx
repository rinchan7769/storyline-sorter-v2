"use client";
import { useEffect, type ButtonHTMLAttributes, type ComponentProps, type ReactNode, type SelectHTMLAttributes } from "react";
import { X } from "lucide-react";
import { cx } from "@/lib/format";

export function Button({
  variant = "primary",
  className,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" | "danger" }) {
  const v = {
    primary: "bg-primary text-primary-foreground hover:opacity-90",
    ghost: "hover:bg-muted",
    outline: "border bg-card hover:bg-muted",
    danger: "bg-danger text-white hover:opacity-90",
  }[variant];
  return (
    <button
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50 disabled:pointer-events-none",
        v,
        className,
      )}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-xl border bg-card p-4 shadow-sm", className)}>{children}</div>;
}

const field = "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40";
export function Input({ className, ...p }: ComponentProps<"input">) {
  return <input {...p} className={cx(field, className)} />;
}
export function Select({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx(field, className)} />;
}
export function Label({ children }: { children: ReactNode }) {
  return <span className="mb-1 block text-xs font-medium text-muted-foreground">{children}</span>;
}

export function Progress({ value, color, over }: { value: number; color?: string; over?: boolean }) {
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(value)}>
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: over ? "var(--danger)" : color || "var(--primary)" }}
      />
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-xl border bg-card p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="閉じる" className="rounded p-1 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return children ? <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{children}</p> : null;
}
