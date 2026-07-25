import assert from "node:assert/strict";
import test from "node:test";
import { FAVICON_SIZES, faviconHtmlSnippet, faviconInitials, faviconManifestSnippet } from "../lib/favicon.ts";

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
