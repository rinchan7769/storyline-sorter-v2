import type { CategoryKind } from "./db/schema";

export const KIND_LABEL: Record<CategoryKind, string> = {
  fixed: "固定費",
  variable: "変動費",
  special: "特別費",
};

export const KIND_COLOR: Record<CategoryKind, string> = {
  fixed: "#6366f1",
  variable: "#f59e0b",
  special: "#ec4899",
};

export const PAYMENT_METHODS = ["現金", "クレジットカード", "銀行引落", "電子マネー", "QR決済", "その他"];

type DefaultCategory = { name: string; kind: CategoryKind; color: string; keywords: string[] };

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  // 固定費
  { name: "住居費", kind: "fixed", color: "#6366f1", keywords: ["家賃", "管理費", "住宅ローン", "不動産", "ハウジング"] },
  { name: "水道光熱費", kind: "fixed", color: "#0ea5e9", keywords: ["電気", "ガス", "水道", "東京電力", "関西電力", "東京ガス", "大阪ガス", "水道局"] },
  { name: "通信費", kind: "fixed", color: "#14b8a6", keywords: ["docomo", "ドコモ", "au", "softbank", "ソフトバンク", "楽天モバイル", "ahamo", "povo", "povo", "光回線", "wifi", "ocn", "nuro", "ntt"] },
  { name: "保険料", kind: "fixed", color: "#8b5cf6", keywords: ["生命保険", "損保", "損害保険", "医療保険", "保険料", "アフラック", "日本生命", "第一生命", "東京海上"] },
  { name: "車両維持費", kind: "fixed", color: "#64748b", keywords: ["駐車場", "ガソリン", "eneos", "出光", "コスモ石油", "idemitsu", "高速", "etc", "タイムズ", "カーシェア"] },
  { name: "サブスク", kind: "fixed", color: "#d946ef", keywords: ["netflix", "ネットフリックス", "spotify", "amazon prime", "プライム", "youtube premium", "apple.com/bill", "icloud", "disney", "hulu", "u-next", "adobe", "chatgpt", "openai", "claude"] },
  // 変動費
  { name: "食費", kind: "variable", color: "#22c55e", keywords: ["スーパー", "イオン", "マルエツ", "ライフ", "西友", "まいばすけっと", "業務スーパー", "コープ", "生協", "セブン", "ローソン", "ファミリーマート", "ファミマ", "パン", "精肉", "青果", "オーケー", "ok"] },
  { name: "外食費", kind: "variable", color: "#f97316", keywords: ["マクドナルド", "スターバックス", "スタバ", "吉野家", "すき家", "松屋", "サイゼリヤ", "ガスト", "ドトール", "コメダ", "レストラン", "食堂", "居酒屋", "カフェ", "ラーメン", "寿司", "くら寿司", "スシロー", "ウーバーイーツ", "uber eats", "出前館", "丸亀製麺"] },
  { name: "日用品", kind: "variable", color: "#eab308", keywords: ["ドラッグ", "マツモトキヨシ", "マツキヨ", "ウエルシア", "ツルハ", "スギ薬局", "ダイソー", "セリア", "ニトリ", "無印良品", "ホームセンター", "カインズ", "コーナン", "ロフト", "amazon", "アマゾン"] },
  { name: "日用交通費", kind: "variable", color: "#06b6d4", keywords: ["suica", "pasmo", "icoca", "jr", "東京メトロ", "都営", "バス", "タクシー", "モバイルsuica", "交通", "電鉄", "地下鉄"] },
  { name: "交際費", kind: "variable", color: "#f43f5e", keywords: ["飲み会", "プレゼント", "ギフト", "手土産", "花", "懇親", "会費"] },
  { name: "趣味・娯楽", kind: "variable", color: "#a855f7", keywords: ["映画", "ゲーム", "steam", "playstation", "nintendo", "任天堂", "書店", "紀伊國屋", "蔦屋", "tsutaya", "ブックオフ", "カラオケ", "ゴルフ", "ジム", "kindle", "楽器"] },
  // 特別費
  { name: "冠婚葬祭", kind: "special", color: "#be185d", keywords: ["結婚式", "ご祝儀", "香典", "葬儀", "斎場", "お祝い"] },
  { name: "旅行・イベント", kind: "special", color: "#0891b2", keywords: ["ホテル", "旅館", "jal", "ana", "航空", "新幹線", "じゃらん", "楽天トラベル", "booking", "airbnb", "ディズニー", "usj", "チケット", "ぴあ", "イープラス"] },
  { name: "家電・家具", kind: "special", color: "#4f46e5", keywords: ["ヨドバシ", "ビックカメラ", "ヤマダ電機", "ケーズデンキ", "エディオン", "イケア", "ikea", "家具", "家電"] },
  { name: "自動車税・車検等", kind: "special", color: "#475569", keywords: ["自動車税", "車検", "自賠責", "オートバックス", "イエローハット", "ディーラー", "固定資産税"] },
];
