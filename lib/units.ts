export type UnitCategoryId = "length" | "area" | "weight" | "volume" | "temperature" | "speed";

type Unit = { id: string; label: string; factor: number };

// factor＝換成基準單位的倍率（長度基準公尺、面積 m²、重量公斤、容量公升、速度 m/s）。
// 溫度不走倍率，見 convertUnits 的特例。台制單位（坪、甲、台斤、台尺）是台灣日常剛需。
export const UNIT_CATEGORIES: Array<{ id: UnitCategoryId; label: string; units: Unit[] }> = [
  {
    id: "length",
    label: "長度",
    units: [
      { id: "mm", label: "公釐 mm", factor: 0.001 },
      { id: "cm", label: "公分 cm", factor: 0.01 },
      { id: "m", label: "公尺 m", factor: 1 },
      { id: "km", label: "公里 km", factor: 1000 },
      { id: "taiChi", label: "台尺", factor: 0.30303 },
      { id: "inch", label: "英吋 in", factor: 0.0254 },
      { id: "ft", label: "英呎 ft", factor: 0.3048 },
      { id: "mile", label: "英里 mi", factor: 1609.344 },
    ],
  },
  {
    id: "area",
    label: "面積",
    units: [
      { id: "m2", label: "平方公尺 m²", factor: 1 },
      { id: "ping", label: "坪", factor: 3.305785 },
      { id: "jia", label: "甲", factor: 9699.17 },
      { id: "hectare", label: "公頃", factor: 10000 },
      { id: "km2", label: "平方公里 km²", factor: 1_000_000 },
      { id: "acre", label: "英畝 acre", factor: 4046.8564224 },
      { id: "ft2", label: "平方英呎 ft²", factor: 0.09290304 },
    ],
  },
  {
    id: "weight",
    label: "重量",
    units: [
      { id: "g", label: "公克 g", factor: 0.001 },
      { id: "kg", label: "公斤 kg", factor: 1 },
      { id: "ton", label: "公噸 t", factor: 1000 },
      { id: "taiJin", label: "台斤", factor: 0.6 },
      { id: "liang", label: "兩（台）", factor: 0.0375 },
      { id: "lb", label: "磅 lb", factor: 0.45359237 },
      { id: "oz", label: "盎司 oz", factor: 0.028349523125 },
    ],
  },
  {
    id: "volume",
    label: "容量",
    units: [
      { id: "ml", label: "毫升 ml（cc）", factor: 0.001 },
      { id: "l", label: "公升 L", factor: 1 },
      { id: "m3", label: "立方公尺 m³", factor: 1000 },
      { id: "cup", label: "量杯（240ml）", factor: 0.24 },
      { id: "galUs", label: "美制加侖 gal", factor: 3.785411784 },
    ],
  },
  {
    id: "temperature",
    label: "溫度",
    units: [
      { id: "c", label: "攝氏 °C", factor: 1 },
      { id: "f", label: "華氏 °F", factor: 1 },
      { id: "k", label: "凱氏 K", factor: 1 },
    ],
  },
  {
    id: "speed",
    label: "速度",
    units: [
      { id: "ms", label: "公尺／秒 m/s", factor: 1 },
      { id: "kmh", label: "公里／小時 km/h", factor: 1 / 3.6 },
      { id: "mph", label: "英里／小時 mph", factor: 0.44704 },
      { id: "knot", label: "節 knot", factor: 0.514444 },
    ],
  },
];

function toCelsius(value: number, unit: string) {
  if (unit === "f") return (value - 32) * (5 / 9);
  if (unit === "k") return value - 273.15;
  return value;
}

function fromCelsius(value: number, unit: string) {
  if (unit === "f") return value * (9 / 5) + 32;
  if (unit === "k") return value + 273.15;
  return value;
}

/** 換算；未知類別或單位回傳 NaN。 */
export function convertUnits(category: UnitCategoryId, fromId: string, toId: string, value: number): number {
  if (!Number.isFinite(value)) return NaN;
  const group = UNIT_CATEGORIES.find((item) => item.id === category);
  if (!group) return NaN;
  if (category === "temperature") {
    if (!group.units.some((unit) => unit.id === fromId) || !group.units.some((unit) => unit.id === toId)) return NaN;
    return fromCelsius(toCelsius(value, fromId), toId);
  }
  const from = group.units.find((unit) => unit.id === fromId);
  const to = group.units.find((unit) => unit.id === toId);
  if (!from || !to) return NaN;
  return (value * from.factor) / to.factor;
}

/** 結果顯示：大數常規、小數最多 6 位有效，去尾零。 */
export function formatConverted(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value !== 0 && Math.abs(value) < 0.000001) return value.toExponential(3);
  const rounded = Math.abs(value) >= 1 ? Number(value.toFixed(4)) : Number(value.toPrecision(6));
  return rounded.toLocaleString("zh-TW", { maximumFractionDigits: 6 });
}
