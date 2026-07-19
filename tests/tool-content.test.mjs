import assert from "node:assert/strict";
import test from "node:test";
import { CATEGORIES, filterTools, tools } from "../lib/tools.ts";
import { toolContent } from "../lib/tool-content.ts";

test("每個工具都有分類，且分類都在定義清單內", () => {
  const ids = new Set(CATEGORIES.map((category) => category.id));
  for (const tool of tools) {
    assert.ok(ids.has(tool.category), `${tool.slug} 的分類 ${tool.category} 不在清單內`);
  }
  for (const id of ids) {
    assert.ok(tools.some((tool) => tool.category === id), `分類 ${id} 沒有任何工具`);
  }
});

test("每個工具都有使用說明與 FAQ 內容", () => {
  for (const tool of tools) {
    const content = toolContent[tool.slug];
    assert.ok(content, `${tool.slug} 缺少內容`);
    assert.ok(content.steps.length >= 3, `${tool.slug} 步驟太少`);
    assert.ok(content.faq.length >= 3, `${tool.slug} FAQ 太少`);
    for (const item of content.faq) {
      assert.ok(item.q.length > 0 && item.a.length > 20, `${tool.slug} FAQ 內容過短`);
    }
  }
  for (const slug of Object.keys(toolContent)) {
    assert.ok(tools.some((tool) => tool.slug === slug), `內容庫有多餘的 ${slug}`);
  }
});

test("filterTools：關鍵字與分類過濾", () => {
  assert.equal(filterTools("", "all").length, tools.length);
  assert.deepEqual(filterTools("pdf", "all").map((tool) => tool.slug), ["pdf-toolkit"]);
  assert.deepEqual(filterTools("密碼", "all").map((tool) => tool.slug), ["password-generator"]);
  const imageTools = filterTools("", "image");
  assert.ok(imageTools.length >= 3 && imageTools.every((tool) => tool.category === "image"));
  assert.deepEqual(filterTools("QR", "image"), []);
  assert.equal(filterTools("不存在的工具xyz", "all").length, 0);
});
