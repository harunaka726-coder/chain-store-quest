/**
 * ブランドマスタ
 * ---------------------------------------------------------------------------
 * 実店舗は Overpass (js/overpass.js) から取得します。
 * initialStores はオフライン／取得失敗時のフォールバック用ダミーです。
 */

window.ChainConstellation = window.ChainConstellation || {};

ChainConstellation.brandCatalog = {
  seven: {
    id: "seven",
    name: "セブン-イレブン",
    shortName: "セブン",
    color: "#e60012",
    colorAlt: "#ff6b6b",
    pitchBase: 261.63
  },
  familymart: {
    id: "familymart",
    name: "ファミリーマート",
    shortName: "ファミマ",
    color: "#009946",
    colorAlt: "#00a0e9",
    pitchBase: 293.66
  },
  lawson: {
    id: "lawson",
    name: "ローソン",
    shortName: "ローソン",
    color: "#0068b7",
    colorAlt: "#e60012",
    pitchBase: 329.63
  },
  starbucks: {
    id: "starbucks",
    name: "スターバックス",
    shortName: "スタバ",
    color: "#00704a",
    colorAlt: "#1e3932",
    pitchBase: 349.23
  },
  mcdonalds: {
    id: "mcdonalds",
    name: "マクドナルド",
    shortName: "マック",
    color: "#ffc72c",
    colorAlt: "#da291c",
    pitchBase: 392.0
  },
  yoshinoya: {
    id: "yoshinoya",
    name: "吉野家",
    shortName: "吉野家",
    color: "#e60012",
    colorAlt: "#ffd100",
    pitchBase: 440.0
  }
};

/** 取得失敗時のみ使う渋谷周辺ダミー */
ChainConstellation.initialStores = [
  { id: "s01", brandId: "seven", name: "セブン-イレブン（ダミー）", lat: 35.6582, lng: 139.6988, source: "dummy" },
  { id: "s02", brandId: "familymart", name: "ファミリーマート（ダミー）", lat: 35.6598, lng: 139.7005, source: "dummy" },
  { id: "s03", brandId: "lawson", name: "ローソン（ダミー）", lat: 35.6612, lng: 139.7018, source: "dummy" },
  { id: "s04", brandId: "starbucks", name: "スターバックス（ダミー）", lat: 35.6620, lng: 139.6982, source: "dummy" },
  { id: "s05", brandId: "mcdonalds", name: "マクドナルド（ダミー）", lat: 35.6591, lng: 139.7028, source: "dummy" },
  { id: "s06", brandId: "seven", name: "セブン-イレブン（ダミー）", lat: 35.6635, lng: 139.6995, source: "dummy" },
  { id: "s07", brandId: "yoshinoya", name: "吉野家（ダミー）", lat: 35.6570, lng: 139.6996, source: "dummy" },
  { id: "s08", brandId: "lawson", name: "ローソン（ダミー）", lat: 35.6618, lng: 139.6975, source: "dummy" },
  { id: "s09", brandId: "familymart", name: "ファミリーマート（ダミー）", lat: 35.6588, lng: 139.7042, source: "dummy" },
  { id: "s10", brandId: "starbucks", name: "スターバックス（ダミー）", lat: 35.6585, lng: 139.7015, source: "dummy" },
  { id: "s12", brandId: "mcdonalds", name: "マクドナルド（ダミー）", lat: 35.6575, lng: 139.6978, source: "dummy" },
  { id: "s13", brandId: "seven", name: "セブン-イレブン（ダミー）", lat: 35.6568, lng: 139.7030, source: "dummy" },
  { id: "s14", brandId: "lawson", name: "ローソン（ダミー）", lat: 35.6595, lng: 139.6990, source: "dummy" },
  { id: "s15", brandId: "familymart", name: "ファミリーマート（ダミー）", lat: 35.6558, lng: 139.7008, source: "dummy" }
];

ChainConstellation.generateId = function generateId(prefix) {
  return (prefix || "store") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
};

/** あとからチェーンを追加（検索用パターンも同時登録） */
ChainConstellation.registerBrand = function registerBrand({ name, shortName, color }) {
  const base = String(name || "").trim();
  if (!base) throw new Error("名前が空です");
  const id =
    "custom_" +
    base
      .toLowerCase()
      .replace(/[^\w\u3040-\u30ff\u4e00-\u9faf]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 24) +
    "_" +
    Math.random().toString(36).slice(2, 6);

  const brand = {
    id,
    name: base,
    shortName: (shortName || base).slice(0, 12),
    color: color || "#3b82f6",
    colorAlt: color || "#93c5fd",
    pitchBase: 300 + Math.random() * 200,
    custom: true
  };
  ChainConstellation.brandCatalog[id] = brand;

  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  ChainConstellation.brandMatchPatterns = ChainConstellation.brandMatchPatterns || {};
  ChainConstellation.brandMatchPatterns[id] = [new RegExp(escaped, "i")];
  return brand;
};
