import assert from "node:assert/strict";
import test from "node:test";
import { smsPayload, vcardPayload, wifiPayload } from "../lib/qr-templates.ts";
import { formatStopwatch } from "../lib/timer.ts";

test("wifiPayload：標準格式與特殊字元跳脫", () => {
  assert.equal(wifiPayload("Home-WiFi", "abc12345", "WPA"), "WIFI:T:WPA;S:Home-WiFi;P:abc12345;;");
  assert.equal(wifiPayload("Cafe;Shop", 'p:a,s"s\\x', "WPA"), 'WIFI:T:WPA;S:Cafe\\;Shop;P:p\\:a\\,s\\"s\\\\x;;');
  assert.equal(wifiPayload("Open Net", "ignored", "nopass"), "WIFI:T:nopass;S:Open Net;;");
});

test("vcardPayload：必填姓名、空欄位不輸出、值跳脫", () => {
  const card = vcardPayload({ name: "王小明", phone: "0912-345-678", email: "a@b.c" });
  assert.ok(card.startsWith("BEGIN:VCARD\nVERSION:3.0\nFN:王小明"));
  assert.match(card, /TEL;TYPE=CELL:0912-345-678/);
  assert.match(card, /EMAIL:a@b\.c/);
  assert.doesNotMatch(card, /ORG|URL/);
  assert.ok(card.endsWith("END:VCARD"));
  assert.equal(vcardPayload({ name: "A, B; C" }).split("\n")[2], "FN:A\\, B\\; C");
});

test("smsPayload：SMSTO 格式", () => {
  assert.equal(smsPayload(" 0912345678 ", " 你好 "), "SMSTO:0912345678:你好");
});

test("formatStopwatch：分秒與小時進位", () => {
  assert.equal(formatStopwatch(0), "00:00");
  assert.equal(formatStopwatch(65_000), "01:05");
  assert.equal(formatStopwatch(3_600_000), "1:00:00");
  assert.equal(formatStopwatch(3_725_000), "1:02:05");
});
