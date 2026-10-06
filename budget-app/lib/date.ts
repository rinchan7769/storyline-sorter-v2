/** 日本時間(JST)での今日の日付。サーバーのTZに依存しない。 */
export function jstNow(base = new Date()): Date {
  return new Date(base.getTime() + 9 * 3600 * 1000);
}
export function todayYmd(base = new Date()): string {
  return jstNow(base).toISOString().slice(0, 10);
}
export function currentMonth(base = new Date()): string {
  return todayYmd(base).slice(0, 7);
}
