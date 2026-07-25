import assert from "node:assert/strict";
import test from "node:test";
import { consumeHandoff, IMAGE_TOOL_SLUGS, TEXT_TOOL_SLUGS, putFileHandoff, putTextHandoff, takeHandoff, toHandoffFile } from "../lib/handoff.ts";
import { WorkspaceRepository } from "../lib/workspace/repository.ts";

function memoryMetadataStore() {
  const rows = new Map();
  return {
    async list() { return [...rows.values()]; },
    async get(id) { return rows.get(id) ?? null; },
    async put(item) { rows.set(item.id, item); },
    async remove(id) { rows.delete(id); },
    async clear() { rows.clear(); },
  };
}

function memoryBlobBackend() {
  const blobs = new Map();
  return {
    kind: "indexeddb",
    async write(key, blob) { blobs.set(key, blob); },
    async read(key) { return blobs.get(key) ?? null; },
    async remove(key) { blobs.delete(key); },
    async clear() { blobs.clear(); },
  };
}

function repository() {
  let counter = 0;
  return new WorkspaceRepository({
    metadata: memoryMetadataStore(),
    blobs: memoryBlobBackend(),
    createId: () => `handoff-${++counter}-${crypto.randomUUID()}`,
    now: () => 1_000_000,
  });
}

function sampleFile(name = "a.png") {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
}

test("handoff：檔案存進 Workspace，取出一次後 token 失效", async () => {
  const workspace = repository();
  const id = await putFileHandoff(sampleFile(), "image-crop", workspace);
  const first = await takeHandoff("file", id, workspace);
  assert.equal(first?.kind, "file");
  assert.equal(first?.fromSlug, "image-crop");
  assert.equal(first?.file.name, "a.png");
  assert.deepEqual(first?.workspaceItemIds, [id]);
  consumeHandoff(first);
  assert.equal(await takeHandoff("file", id, workspace), null);
});

test("handoff：文字存進 Workspace，種類不符時不消費", async () => {
  const workspace = repository();
  const id = await putTextHandoff("今天天氣很好", "text-cleaner", workspace);
  assert.equal(await takeHandoff("file", id, workspace), null);
  const first = await takeHandoff("text", id, workspace);
  assert.equal(first?.kind, "text");
  assert.equal(first?.text, "今天天氣很好");
  assert.equal(first?.fromSlug, "text-cleaner");
});

test("handoff：批次結果以同一個 Workspace group 還原整批", async () => {
  const workspace = repository();
  const id = await putFileHandoff([sampleFile("one.png"), sampleFile("two.png")], "image-compressor", workspace);
  const handoff = await takeHandoff("file", id, workspace);
  assert.equal(handoff?.kind, "file");
  assert.deepEqual(handoff?.files.map((file) => file.name), ["one.png", "two.png"]);
  assert.equal(handoff?.workspaceItemIds.length, 2);
});

test("toHandoffFile：保留檔名與 MIME，空 type 有退路", () => {
  const named = toHandoffFile(new Blob([new Uint8Array([1])], { type: "image/webp" }), "out.webp");
  assert.equal(named.name, "out.webp");
  assert.equal(named.type, "image/webp");
  assert.equal(toHandoffFile(new Blob([new Uint8Array([1])]), "x.bin").type, "application/octet-stream");
});

test("接力目標由 manifest 推導，且都是已註冊的工具 slug", async () => {
  const { tools } = await import("../lib/tools.ts");
  const slugs = new Set(tools.map((tool) => tool.slug));
  assert.deepEqual(IMAGE_TOOL_SLUGS, ["background-remover", "image-compressor", "exif-cleaner", "image-crop", "image-converter"]);
  assert.deepEqual(TEXT_TOOL_SLUGS, ["text-cleaner", "chinese-converter", "text-compare", "markdown-editor"]);
  for (const slug of [...IMAGE_TOOL_SLUGS, ...TEXT_TOOL_SLUGS]) assert.ok(slugs.has(slug), `${slug} 不在工具註冊表`);
});
