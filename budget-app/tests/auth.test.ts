import { describe, expect, it } from "vitest";
import { checkPassword, createToken, verifyToken } from "@/lib/auth";

describe("auth", () => {
  it("正しい署名・期限内のトークンだけ通す", async () => {
    const t = await createToken("s3cret", 1000);
    expect(await verifyToken(t, "s3cret", 2000)).toBe(true);
    expect(await verifyToken(t, "other", 2000)).toBe(false);
    expect(await verifyToken(t + "x", "s3cret", 2000)).toBe(false);
    expect(await verifyToken(t, "s3cret", 1000 + 31 * 24 * 3600 * 1000)).toBe(false);
    expect(await verifyToken(undefined, "s3cret")).toBe(false);
  });
  it("パスワード照合", async () => {
    expect(await checkPassword("abc", "abc")).toBe(true);
    expect(await checkPassword("abd", "abc")).toBe(false);
    expect(await checkPassword("", "")).toBe(false);
  });
});
