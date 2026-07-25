import assert from "node:assert/strict";
import test from "node:test";
import { IMAGE_TOOL_SLUGS, TEXT_TOOL_SLUGS, putFileHandoff, putTextHandoff, takeHandoff, toHandoffFile } from "../lib/handoff.ts";

function sampleFile(name = "a.png") {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

test("handoff：檔案取出一次就清空", () => {
  putFileHandoff(sampleFile(), "image-crop");
  const first = takeHandoff("file");
  assert.equal(first?.kind, "file");
  assert.equal(first?.fromSlug, "image-crop");
  assert.equal(first?.file.name, "a.png");
  // 用上一頁／下一頁回到接收端時不該重複套用同一個檔案。
  assert.equal(takeHandoff("file"), null);
});

test("handoff：文字取出一次就清空", () => {
  putTextHandoff("今天天氣很好", "text-cleaner");
  const first = takeHandoff("text");
  assert.equal(first?.kind, "text");
  assert.equal(first?.text, "今天天氣很好");
  assert.equal(first?.fromSlug, "text-cleaner");
  assert.equal(takeHandoff("text"), null);
});

test("handoff：種類不符時不消費——圖片工具不能把待交接的文字吃掉", () => {
  putTextHandoff("要送去繁簡轉換的內容", "text-cleaner");
  // 路上先掛載到某個圖片工具：它取不到東西，而且**不能**把文字清掉
  assert.equal(takeHandoff("file"), null);
  // 文字接收端仍然拿得到
  assert.equal(takeHandoff("text")?.text, "要送去繁簡轉換的內容");
});

test("handoff：反向也成立——文字工具不能吃掉待交接的檔案", () => {
  putFileHandoff(sampleFile("keep.png"), "image-crop");
  assert.equal(takeHandoff("text"), null);
  assert.equal(takeHandoff("file")?.file.name, "keep.png");
});

test("handoff：沒有交接時回傳 null", () => {
  takeHandoff("file"); takeHandoff("text");
  assert.equal(takeHandoff("file"), null);
  assert.equal(takeHandoff("text"), null);
});

test("handoff：後放的覆蓋前一個，跨種類也一樣", () => {
  putFileHandoff(sampleFile("first.png"), "image-crop");
  putTextHandoff("後來居上", "text-cleaner");
  // 檔案已經被文字取代，取不到了
  assert.equal(takeHandoff("file"), null);
  assert.equal(takeHandoff("text")?.text, "後來居上");
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
  for (const slug of [...IMAGE_TOOL_SLUGS, ...TEXT_TOOL_SLUGS]) {
    assert.ok(slugs.has(slug), `${slug} 不在工具註冊表`);
  }
});
