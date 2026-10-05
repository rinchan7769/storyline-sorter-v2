/** 単一パスワード認証。HMAC署名付きの有効期限つきCookie(Web Crypto のみ使用)。 */
export const COOKIE = "budget_session";
export const MAX_AGE = 60 * 60 * 24 * 30; // 30日

const enc = new TextEncoder();

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** 認証設定。パスワード未設定の本番環境は全拒否(開発時のみ認証なし)。 */
export function authConfig() {
  const password = process.env.APP_PASSWORD || "";
  const secret = process.env.AUTH_SECRET || password;
  const disabled = !password && process.env.NODE_ENV !== "production";
  return { password, secret, disabled, misconfigured: !password && !disabled };
}

export async function createToken(secret: string, now = Date.now()): Promise<string> {
  const exp = String(now + MAX_AGE * 1000);
  return `${exp}.${await hmac(exp, secret)}`;
}

export async function verifyToken(token: string | undefined, secret: string, now = Date.now()): Promise<boolean> {
  if (!token || !secret) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < now) return false;
  return safeEqual(sig, await hmac(exp, secret));
}

export async function checkPassword(input: string, password: string): Promise<boolean> {
  if (!password) return false;
  // 長さを隠すためハッシュ同士を比較する
  return safeEqual(await hmac(input, "pw"), await hmac(password, "pw"));
}
