import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PASSWORD_OPTIONS, PASSWORD_MAX, PASSWORD_MIN, characterClasses, generatePassword, passwordEntropyBits, passwordStrength } from "../lib/password.ts";
import { FAVICON_SIZES, faviconHtmlSnippet, faviconInitials, faviconManifestSnippet } from "../lib/favicon.ts";

test("password respects length and always includes each selected class", () => {
  const options = { length: 24, lowercase: true, uppercase: true, digits: true, symbols: true, excludeSimilar: false };
  for (let round = 0; round < 30; round += 1) {
    const password = generatePassword(options);
    assert.equal(password.length, 24);
    assert.match(password, /[a-z]/, "缺小寫");
    assert.match(password, /[A-Z]/, "缺大寫");
    assert.match(password, /[0-9]/, "缺數字");
    assert.match(password, /[^A-Za-z0-9]/, "缺符號");
  }
});

test("password length clamps to bounds", () => {
  assert.equal(generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 1 }).length, PASSWORD_MIN);
  assert.equal(generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 9999 }).length, PASSWORD_MAX);
});

test("excludeSimilar removes ambiguous characters", () => {
  const options = { length: 200, lowercase: true, uppercase: true, digits: true, symbols: false, excludeSimilar: true };
  const password = generatePassword(options);
  assert.doesNotMatch(password, /[O0oIl1|5S2Z8B]/);
});

test("password throws with no character class", () => {
  assert.throws(() => generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, lowercase: false, uppercase: false, digits: false, symbols: false }), /至少選擇/);
  assert.equal(characterClasses({ ...DEFAULT_PASSWORD_OPTIONS, lowercase: false, uppercase: false, digits: false, symbols: false }).length, 0);
});

test("entropy grows with length and pool, strength labels track thresholds", () => {
  const small = passwordEntropyBits({ ...DEFAULT_PASSWORD_OPTIONS, length: 6, lowercase: true, uppercase: false, digits: false, symbols: false });
  const big = passwordEntropyBits({ ...DEFAULT_PASSWORD_OPTIONS, length: 20 });
  assert.ok(big > small);
  assert.equal(passwordStrength(30).level, "weak");
  assert.equal(passwordStrength(50).level, "fair");
  assert.equal(passwordStrength(80).level, "strong");
  assert.equal(passwordStrength(130).level, "excellent");
});

test("favicon initials handle CJK, latin words and emoji", () => {
  assert.equal(faviconInitials("ToolVerse"), "TO");
  assert.equal(faviconInitials("Hello World"), "HW");
  assert.equal(faviconInitials("工具"), "工");
  assert.equal(faviconInitials("  a  "), "A");
  assert.equal(faviconInitials(""), "");
});

test("favicon snippets and size set are well-formed", () => {
  assert.ok(FAVICON_SIZES.some((item) => item.size === 32) && FAVICON_SIZES.some((item) => item.size === 512));
  assert.match(faviconHtmlSnippet(), /apple-touch-icon/);
  const manifest = JSON.parse(faviconManifestSnippet("Demo"));
  assert.equal(manifest.name, "Demo");
  assert.equal(manifest.icons.length, 2);
});
