import assert from "node:assert/strict";
import test from "node:test";
import { IMAGE_TOOL_SLUGS, putHandoff, takeHandoff, toHandoffFile } from "../lib/handoff.ts";

function sampleFile(name = "a.png") {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

test("handoff：取出一次就清空", () => {
  putHandoff(sampleFile(), "image-crop");
  const first = takeHandoff();
  assert.equal(first?.fromSlug, "image-crop");
  assert.equal(first?.file.name, "a.png");
  // 用上一頁／下一頁回到接收端時不該重複套用同一個檔案。
  assert.equal(takeHandoff(), null);
});

test("handoff：沒有交接時回傳 null", () => {
  takeHandoff();
  assert.equal(takeHandoff(), null);
});

test("handoff：後放的覆蓋前一個", () => {
  putHandoff(sampleFile("first.png"), "image-crop");
  putHandoff(sampleFile("second.png"), "exif-cleaner");
  const taken = takeHandoff();
  assert.equal(taken?.file.name, "second.png");
  assert.equal(taken?.fromSlug, "exif-cleaner");
});

test("toHandoffFile：保留檔名與 MIME，空 type 有退路", () => {
  const named = toHandoffFile(new Blob([new Uint8Array([1])], { type: "image/webp" }), "out.webp");
  assert.equal(named.name, "out.webp");
  assert.equal(named.type, "image/webp");
  assert.equal(toHandoffFile(new Blob([new Uint8Array([1])]), "x.bin").type, "application/octet-stream");
});

test("接力目標都是已註冊的工具 slug", async () => {
  const { tools } = await import("../lib/tools.ts");
  const slugs = new Set(tools.map((tool) => tool.slug));
  for (const slug of IMAGE_TOOL_SLUGS) assert.ok(slugs.has(slug), `${slug} 不在工具註冊表`);
});
