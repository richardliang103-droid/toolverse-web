import assert from "node:assert/strict";
import test from "node:test";
import { UNIT_CATEGORIES, convertUnits, formatConverted } from "../lib/units.ts";
import { barcodeFilename, ean13Checksum, validateBarcode } from "../lib/barcode.ts";
import { applyAspect, clampCropRect, toNaturalRect } from "../lib/crop.ts";

test("convertUnits：長度、面積（坪）、重量（台斤）", () => {
  assert.ok(Math.abs(convertUnits("length", "cm", "inch", 2.54) - 1) < 1e-9);
  assert.ok(Math.abs(convertUnits("length", "km", "m", 1.5) - 1500) < 1e-9);
  assert.ok(Math.abs(convertUnits("area", "ping", "m2", 1) - 3.305785) < 1e-6);
  assert.ok(Math.abs(convertUnits("area", "jia", "ping", 1) - 2934) < 1);
  assert.ok(Math.abs(convertUnits("weight", "taiJin", "g", 1) - 600) < 1e-9);
});

test("convertUnits：溫度公式與無效輸入", () => {
  assert.equal(convertUnits("temperature", "c", "f", 100), 212);
  assert.equal(convertUnits("temperature", "f", "c", 32), 0);
  assert.ok(Math.abs(convertUnits("temperature", "c", "k", 0) - 273.15) < 1e-9);
  assert.ok(Number.isNaN(convertUnits("length", "cm", "nope", 1)));
  assert.ok(Number.isNaN(convertUnits("length", "cm", "m", NaN)));
});

test("每個類別至少有兩個單位，id 不重複", () => {
  for (const group of UNIT_CATEGORIES) {
    assert.ok(group.units.length >= 2, group.id);
    const ids = group.units.map((unit) => unit.id);
    assert.equal(new Set(ids).size, ids.length, group.id);
  }
});

test("formatConverted：格式化規則", () => {
  assert.equal(formatConverted(NaN), "—");
  assert.equal(formatConverted(1500), "1,500");
  assert.equal(formatConverted(0), "0");
});

test("ean13Checksum 與 validateBarcode", () => {
  // 業界標準範例：400638133393 → 檢查碼 1（EAN 官方文件常用例）
  assert.equal(ean13Checksum("400638133393"), 1);
  assert.equal(validateBarcode("EAN13", "400638133393").value, "4006381333931");
  assert.equal(validateBarcode("EAN13", "4006381333931").value, "4006381333931");
  assert.match(validateBarcode("EAN13", "4006381333930").error ?? "", /檢查碼不符/);
  assert.match(validateBarcode("EAN13", "abc").error ?? "", /12 或 13 位/);
  assert.equal(validateBarcode("CODE128", "ORDER-001").value, "ORDER-001");
  assert.match(validateBarcode("CODE128", "中文").error ?? "", /不含中文/);
  assert.match(validateBarcode("CODE128", "").error ?? "", /請輸入/);
  assert.equal(barcodeFilename("ORDER 001/2026"), "ORDER-001-2026");
});

test("crop 幾何：clamp、aspect、座標換算", () => {
  assert.deepEqual(clampCropRect({ x: -10, y: -10, w: 50, h: 50 }, 100, 100), { x: 0, y: 0, w: 50, h: 50 });
  assert.deepEqual(clampCropRect({ x: 80, y: 80, w: 50, h: 50 }, 100, 100), { x: 50, y: 50, w: 50, h: 50 });
  const square = applyAspect({ x: 10, y: 10, w: 80, h: 40 }, 1, 200, 200);
  assert.ok(Math.abs(square.w - square.h) < 1e-9);
  const natural = toNaturalRect({ x: 10, y: 10, w: 50, h: 50 }, 2, 200, 200);
  assert.deepEqual(natural, { x: 20, y: 20, w: 100, h: 100 });
});
