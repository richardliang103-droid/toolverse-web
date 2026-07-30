import assert from "node:assert/strict";
import test from "node:test";
import { qrTextForTemplate, smsPayload, vcardPayload, wifiPayload } from "../lib/qr-templates.ts";
import { formatStopwatch } from "../lib/timer.ts";

test("wifiPayload：標準格式與特殊字元跳脫", () => {
  assert.equal(wifiPayload("Home-WiFi", "abc12345", "WPA"), "WIFI:T:WPA;S:Home-WiFi;P:abc12345;;");
  assert.equal(wifiPayload("Cafe;Shop", 'p:a,s"s\\x', "WPA"), 'WIFI:T:WPA;S:Cafe\\;Shop;P:p\\:a\\,s\\"s\\\\x;;');
  assert.equal(wifiPayload("Open Net", "ignored", "nopass"), "WIFI:T:nopass;S:Open Net;;");
  assert.equal(wifiPayload("   ", "secret", "WPA"), "");
});

test("vcardPayload：必填姓名、空欄位不輸出、值跳脫", () => {
  const card = vcardPayload({ name: "王小明", phone: "0912-345-678", email: "a@b.c" });
  assert.ok(card.startsWith("BEGIN:VCARD\nVERSION:3.0\nFN:王小明"));
  assert.match(card, /TEL;TYPE=CELL:0912-345-678/);
  assert.match(card, /EMAIL:a@b\.c/);
  assert.doesNotMatch(card, /ORG|URL/);
  assert.ok(card.endsWith("END:VCARD"));
  assert.equal(vcardPayload({ name: "A, B; C" }).split("\n")[2], "FN:A\\, B\\; C");
  assert.equal(vcardPayload({ name: "  ", phone: "0912345678" }), "");
});

test("smsPayload：SMSTO 格式", () => {
  assert.equal(smsPayload(" 0912345678 ", " 你好 "), "SMSTO:0912345678:你好");
  assert.equal(smsPayload("  ", "不應保留的內容"), "");
});

test("qrTextForTemplate：切換模板不沿用上一份內容", () => {
  const emptyValues = {
    wifi: { ssid: "", password: "", auth: "WPA" },
    vcard: { name: "", phone: "", email: "", org: "", url: "" },
    sms: { phone: "", message: "" },
  };
  assert.equal(qrTextForTemplate("wifi", "https://old.example", emptyValues), "");
  assert.equal(qrTextForTemplate("vcard", "https://old.example", emptyValues), "");
  assert.equal(qrTextForTemplate("sms", "https://old.example", emptyValues), "");
  assert.equal(qrTextForTemplate("free", "WIFI:T:WPA;S:Home;;", emptyValues), "WIFI:T:WPA;S:Home;;");

  assert.equal(
    qrTextForTemplate("wifi", "SMSTO:0900:舊內容", {
      ...emptyValues,
      wifi: { ssid: "Home", password: "secret", auth: "WPA" },
    }),
    "WIFI:T:WPA;S:Home;P:secret;;",
  );
});

test("formatStopwatch：分秒與小時進位", () => {
  assert.equal(formatStopwatch(0), "00:00.00");
  assert.equal(formatStopwatch(65_000), "01:05.00");
  assert.equal(formatStopwatch(3_600_000), "1:00:00.00");
  assert.equal(formatStopwatch(3_725_000), "1:02:05.00");
});
