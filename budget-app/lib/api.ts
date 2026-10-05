import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response> | Response) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof ZodError) {
        return json({ error: "入力が不正です", issues: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
      }
      console.error(e);
      return json({ error: e instanceof Error ? e.message : "サーバーエラー" }, 500);
    }
  };
}
