import assert from "node:assert/strict";
import test from "node:test";
import { safeFileName, splitFileName, storageKeyFor, uniqueFileName } from "../lib/workspace/naming.ts";
import { expiryFor, selectExpired, sortByNewest, summarize, temporaryExpiry } from "../lib/workspace/cleanup.ts";
import { migrateWorkspaceItems, sanitizeWorkspaceItem } from "../lib/workspace/migration.ts";
import { checksumOf, sha256Hex } from "../lib/workspace/hash.ts";
import { WorkspaceRepository } from "../lib/workspace/repository.ts";
import { WORKSPACE_SCHEMA_VERSION, WorkspaceQuotaError, isQuotaError } from "../lib/workspace/types.ts";

/** 記憶體版 metadata store，行為對齊 IndexedDB 的那份實作。 */
function memoryMetadataStore() {
  const rows = new Map();
  return {
    rows,
    async list() { return [...rows.values()]; },
    async get(id) { return rows.get(id) ?? null; },
    async put(item) { rows.set(item.id, item); },
    async remove(id) { rows.delete(id); },
    async clear() { rows.clear(); },
  };
}

/** 記憶體版 Blob 後端。`failWrite` 用來模擬空間不足。 */
function memoryBlobBackend(kind = "indexeddb") {
  const blobs = new Map();
  return {
    kind,
    blobs,
    failWrite: null,
    async write(key, blob) {
      if (this.failWrite) throw this.failWrite;
      blobs.set(key, blob);
    },
    async read(key) { return blobs.get(key) ?? null; },
    async remove(key) { blobs.delete(key); },
    async clear() { blobs.clear(); },
  };
}

function makeRepository(overrides = {}) {
  const metadata = overrides.metadata ?? memoryMetadataStore();
  const blobs = overrides.blobs ?? memoryBlobBackend();
  let counter = 0;
  const repository = new WorkspaceRepository({
    metadata,
    blobs,
    now: overrides.now ?? (() => 1_000_000),
    ttlMs: overrides.ttlMs,
    createId: overrides.createId ?? (() => `id-${(counter += 1)}`),
    estimate: overrides.estimate,
    readBackends: overrides.readBackends,
  });
  return { repository, metadata, blobs };
}

function blobOf(text) {
  return new Blob([text], { type: "text/plain" });
}

// ---------- naming ----------

test("splitFileName：拆出主檔名與副檔名，隱藏檔不算副檔名", () => {
  assert.deepEqual(splitFileName("photo.PNG"), { stem: "photo", extension: ".png" });
  assert.deepEqual(splitFileName("archive.tar.gz"), { stem: "archive.tar", extension: ".gz" });
  assert.deepEqual(splitFileName("README"), { stem: "README", extension: null });
  assert.deepEqual(splitFileName(".gitignore"), { stem: ".gitignore", extension: null });
  assert.deepEqual(splitFileName("trailing."), { stem: "trailing.", extension: null });
});

test("safeFileName：清掉路徑字元，但保留句點、連字號與括號", () => {
  assert.equal(safeFileName("../../etc/passwd"), "....etcpasswd");
  assert.equal(safeFileName("my-photo (1).png"), "my-photo (1).png");
  assert.equal(safeFileName("  "), "未命名檔案");
  assert.equal(safeFileName("."), "未命名檔案");
});

test("uniqueFileName：同名不覆蓋，序號加在副檔名前", () => {
  assert.equal(uniqueFileName([], "a.png"), "a.png");
  assert.equal(uniqueFileName(["a.png"], "a.png"), "a (2).png");
  assert.equal(uniqueFileName(["a.png", "a (2).png"], "a.png"), "a (3).png");
  // 已經帶序號的名字要接著編下去，不能變成「a (2) (2).png」
  assert.equal(uniqueFileName(["a (2).png"], "a (2).png"), "a (3).png");
  // 沒有副檔名也要能編號
  assert.equal(uniqueFileName(["README"], "README"), "README (2)");
  // 比對不分大小寫，否則下載到同一個資料夾還是會撞名
  assert.equal(uniqueFileName(["A.PNG"], "a.png"), "a (2).png");
});

test("storageKeyFor：用 id 而不是檔名，改名不必搬 Blob", () => {
  assert.equal(storageKeyFor("uuid-1", ".png"), "uuid-1.png");
  assert.equal(storageKeyFor("uuid-1", null), "uuid-1");
});

// ---------- cleanup ----------

test("expiryFor：pinned 不過期，暫存項目從現在起算", () => {
  assert.equal(expiryFor(true, 0), null);
  assert.equal(expiryFor(false, 0, 1000), new Date(1000).toISOString());
  assert.equal(temporaryExpiry(0, 60_000), new Date(60_000).toISOString());
});

test("selectExpired：只挑過期的暫存項目，pinned 一律跳過", () => {
  const items = [
    { id: "expired", pinned: false, expiresAt: new Date(500).toISOString() },
    { id: "fresh", pinned: false, expiresAt: new Date(5000).toISOString() },
    { id: "pinned-old", pinned: true, expiresAt: new Date(1).toISOString() },
    { id: "no-expiry", pinned: false, expiresAt: null },
    { id: "broken-date", pinned: false, expiresAt: "not-a-date" },
  ];
  assert.deepEqual(selectExpired(items, 1000).map((item) => item.id), ["expired"]);
});

test("summarize 與 sortByNewest", () => {
  const items = [
    { id: "a", pinned: true, sizeBytes: 100, createdAt: new Date(1000).toISOString() },
    { id: "b", pinned: false, sizeBytes: 50, createdAt: new Date(3000).toISOString() },
    { id: "c", pinned: false, sizeBytes: Number.NaN, createdAt: new Date(2000).toISOString() },
  ];
  assert.deepEqual(summarize(items), { count: 3, pinnedCount: 1, totalBytes: 150 });
  assert.deepEqual(sortByNewest(items).map((item) => item.id), ["b", "c", "a"]);
});

// ---------- migration ----------

function rawItem(overrides = {}) {
  return {
    id: "raw-1",
    name: "photo.png",
    mimeType: "image/png",
    extension: ".png",
    sizeBytes: 10,
    sourceTool: "image-crop",
    createdAt: new Date(1000).toISOString(),
    updatedAt: new Date(1000).toISOString(),
    expiresAt: new Date(9000).toISOString(),
    pinned: false,
    storageBackend: "indexeddb",
    storageKey: "raw-1.png",
    parentItemIds: [],
    metadata: {},
    schemaVersion: 1,
    ...overrides,
  };
}

test("sanitize：缺少關鍵欄位的記錄一律丟掉", () => {
  assert.equal(sanitizeWorkspaceItem(null), null);
  assert.equal(sanitizeWorkspaceItem("not an object"), null);
  assert.equal(sanitizeWorkspaceItem(rawItem({ id: "" })), null);
  assert.equal(sanitizeWorkspaceItem(rawItem({ storageKey: undefined })), null);
  assert.equal(sanitizeWorkspaceItem(rawItem({ storageBackend: "s3" })), null);
  assert.equal(sanitizeWorkspaceItem(rawItem({ sizeBytes: -1 })), null);
  assert.equal(sanitizeWorkspaceItem(rawItem({ sizeBytes: "10" })), null);
});

test("sanitize：壞掉的次要欄位換成安全預設值，不整筆丟掉", () => {
  const item = sanitizeWorkspaceItem(rawItem({ name: "", mimeType: 42, parentItemIds: "x", metadata: [1] }));
  assert.equal(item.name, "未命名檔案");
  assert.equal(item.mimeType, "application/octet-stream");
  assert.deepEqual(item.parentItemIds, []);
  assert.deepEqual(item.metadata, {});
  assert.equal(item.schemaVersion, WORKSPACE_SCHEMA_VERSION);
});

test("migration：v0 記錄沒有 pinned／expiresAt，補的 TTL 從它自己的建立時間起算", () => {
  const legacy = rawItem({ pinned: undefined, expiresAt: undefined, createdAt: new Date(1000).toISOString() });
  delete legacy.pinned;
  delete legacy.expiresAt;

  const item = sanitizeWorkspaceItem(legacy, 8_000_000);
  assert.equal(item.pinned, false);
  // 從 createdAt（1000）起算，不是從「這次載入」（8000000）起算——
  // 否則每次開網頁都會把到期時間往後推，暫存項目永遠清不掉。
  assert.equal(item.expiresAt, temporaryExpiry(1000));
});

test("migration：pinned 的記錄一律沒有到期時間", () => {
  const item = sanitizeWorkspaceItem(rawItem({ pinned: true, expiresAt: new Date(9000).toISOString() }));
  assert.equal(item.pinned, true);
  assert.equal(item.expiresAt, null);
});

test("migration：壞記錄與重複 id 都不會讓整個工作區打不開", () => {
  const items = migrateWorkspaceItems([rawItem(), null, rawItem({ id: "raw-1", name: "duplicate.png" }), rawItem({ id: "raw-2" })]);
  assert.deepEqual(items.map((item) => item.id), ["raw-1", "raw-2"]);
  assert.equal(items[0].name, "photo.png");
});

// ---------- hash ----------

test("sha256Hex：對得上已知值", async () => {
  assert.equal(await sha256Hex(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("checksumOf：內容相同就同指紋，超過上限則不計算", async () => {
  assert.equal(await checksumOf(blobOf("same")), await checksumOf(blobOf("same")));
  assert.notEqual(await checksumOf(blobOf("a")), await checksumOf(blobOf("b")));
  assert.equal(await checksumOf(new Blob([new Uint8Array(17 * 1024 * 1024)])), undefined);
});

// ---------- repository ----------

test("repository：存進去讀得回來，欄位齊全", async () => {
  const { repository, blobs } = makeRepository();
  const item = await repository.save({ name: "note.txt", blob: blobOf("hello"), sourceTool: "text-cleaner" });

  assert.equal(item.name, "note.txt");
  assert.equal(item.extension, ".txt");
  assert.equal(item.sizeBytes, 5);
  assert.equal(item.sourceTool, "text-cleaner");
  assert.equal(item.pinned, false);
  assert.equal(item.storageBackend, "indexeddb");
  assert.ok(item.expiresAt, "暫存項目要有到期時間");
  assert.equal(blobs.blobs.size, 1);
  assert.equal(await (await repository.read(item.id)).text(), "hello");
});

test("repository：備份還原可保留原始建立時間，但更新時間仍是本次匯入時間", async () => {
  const { repository } = makeRepository();
  const item = await repository.save({
    name: "old.txt",
    blob: blobOf("old"),
    createdAt: "2025-01-02T03:04:05.000Z",
  });
  assert.equal(item.createdAt, "2025-01-02T03:04:05.000Z");
  assert.equal(item.updatedAt, new Date(1_000_000).toISOString());
});

test("repository：readAsFile 帶著檔名與 MIME 回來", async () => {
  const { repository } = makeRepository();
  const item = await repository.save({ name: "note.txt", blob: blobOf("hi") });
  const file = await repository.readAsFile(item.id);
  assert.equal(file.name, "note.txt");
  assert.equal(file.type, "text/plain");
  assert.equal(await file.text(), "hi");
});

test("repository：同名檔案不互相覆蓋", async () => {
  const { repository } = makeRepository();
  const first = await repository.save({ name: "photo.png", blob: blobOf("one") });
  const second = await repository.save({ name: "photo.png", blob: blobOf("two") });

  assert.equal(first.name, "photo.png");
  assert.equal(second.name, "photo (2).png");
  assert.equal(await (await repository.read(first.id)).text(), "one");
  assert.equal(await (await repository.read(second.id)).text(), "two");
  assert.equal((await repository.list()).length, 2);
});

test("repository：刪除時 metadata 與 Blob 一起消失", async () => {
  const { repository, metadata, blobs } = makeRepository();
  const item = await repository.save({ name: "a.txt", blob: blobOf("x") });

  assert.equal(await repository.remove(item.id), true);
  assert.equal(metadata.rows.size, 0);
  assert.equal(blobs.blobs.size, 0);
  assert.equal(await repository.read(item.id), null);
  // 刪第二次不該當成成功
  assert.equal(await repository.remove(item.id), false);
});

test("repository：Blob 寫入失敗時不留下殘缺 metadata", async () => {
  const { repository, metadata, blobs } = makeRepository();
  blobs.failWrite = new DOMException("full", "QuotaExceededError");

  await assert.rejects(
    () => repository.save({ name: "big.bin", blob: blobOf("x") }),
    (error) => error instanceof WorkspaceQuotaError,
  );
  assert.equal(metadata.rows.size, 0, "沒寫成 Blob 就不該有 metadata");
});

test("repository：metadata 寫入失敗時把已寫入的 Blob 收回來", async () => {
  const metadata = memoryMetadataStore();
  metadata.put = async () => { throw new Error("metadata 寫入失敗"); };
  const { repository, blobs } = makeRepository({ metadata });

  await assert.rejects(() => repository.save({ name: "a.txt", blob: blobOf("x") }));
  assert.equal(blobs.blobs.size, 0, "不該留下孤兒 Blob");
});

test("repository：setPinned 切換保留與到期時間", async () => {
  const { repository } = makeRepository();
  const item = await repository.save({ name: "a.txt", blob: blobOf("x") });

  const pinned = await repository.setPinned(item.id, true);
  assert.equal(pinned.pinned, true);
  assert.equal(pinned.expiresAt, null);

  // 取消保留要重新給到期時間，否則它會永遠留著
  const unpinned = await repository.setPinned(item.id, false);
  assert.equal(unpinned.pinned, false);
  assert.ok(unpinned.expiresAt);

  assert.equal(await repository.setPinned("missing", true), null);
});

test("repository：cleanup 清掉過期暫存，絕不動 pinned", async () => {
  let now = 0;
  const { repository } = makeRepository({ now: () => now, ttlMs: 1000 });

  const temporary = await repository.save({ name: "temp.txt", blob: blobOf("t") });
  const kept = await repository.save({ name: "keep.txt", blob: blobOf("k"), pinned: true });

  now = 5000;
  assert.equal(await repository.cleanup(), 1);
  const remaining = await repository.list();
  assert.deepEqual(remaining.map((entry) => entry.id), [kept.id]);
  assert.equal(await repository.read(temporary.id), null);
  assert.equal(await (await repository.read(kept.id)).text(), "k");
});

test("repository：cleanup 在還沒過期時什麼都不刪", async () => {
  const { repository } = makeRepository({ now: () => 0, ttlMs: 10_000 });
  await repository.save({ name: "a.txt", blob: blobOf("x") });
  assert.equal(await repository.cleanup(), 0);
  assert.equal((await repository.list()).length, 1);
});

test("repository：clear 清空所有後端與 metadata", async () => {
  const { repository, metadata, blobs } = makeRepository();
  await repository.save({ name: "a.txt", blob: blobOf("x"), pinned: true });
  await repository.save({ name: "b.txt", blob: blobOf("y") });

  await repository.clear();
  assert.equal(metadata.rows.size, 0);
  assert.equal(blobs.blobs.size, 0);
});

test("repository：舊項目存在另一個後端時仍讀得到", async () => {
  const metadata = memoryMetadataStore();
  const indexedDb = memoryBlobBackend("indexeddb");
  const opfs = memoryBlobBackend("opfs");

  // 第一次：OPFS 可用，項目存進 OPFS
  const first = makeRepository({ metadata, blobs: opfs, readBackends: [indexedDb] });
  const item = await first.repository.save({ name: "a.txt", blob: blobOf("from-opfs") });
  assert.equal(item.storageBackend, "opfs");

  // 第二次：OPFS 探測失敗改用 IndexedDB，舊項目照 metadata 記錄的後端仍找得到
  const second = makeRepository({ metadata, blobs: indexedDb, readBackends: [opfs] });
  assert.equal(await (await second.repository.read(item.id)).text(), "from-opfs");
});

test("repository：usage 回報數量、大小與瀏覽器配額", async () => {
  const { repository } = makeRepository({ estimate: async () => ({ usage: 4096, quota: 8192 }) });
  await repository.save({ name: "a.txt", blob: blobOf("12345"), pinned: true });
  await repository.save({ name: "b.txt", blob: blobOf("123") });

  assert.deepEqual(await repository.usage(), {
    count: 2, pinnedCount: 1, totalBytes: 8, quotaBytes: 8192, originUsageBytes: 4096,
  });
});

test("repository：配額估算失敗不會讓 usage 爆掉", async () => {
  const { repository } = makeRepository({ estimate: async () => { throw new Error("nope"); } });
  const usage = await repository.usage();
  assert.equal(usage.quotaBytes, null);
  assert.equal(usage.originUsageBytes, null);
});

test("repository：findByChecksum 找得到內容相同的其他項目", async () => {
  const { repository } = makeRepository();
  const first = await repository.save({ name: "a.txt", blob: blobOf("same") });
  const second = await repository.save({ name: "b.txt", blob: blobOf("same") });
  await repository.save({ name: "c.txt", blob: blobOf("different") });

  const duplicates = await repository.findByChecksum(first.checksumSha256, first.id);
  assert.deepEqual(duplicates.map((item) => item.id), [second.id]);
});

test("isQuotaError：認得三種表現方式", () => {
  assert.equal(isQuotaError(new WorkspaceQuotaError()), true);
  assert.equal(isQuotaError(new DOMException("full", "QuotaExceededError")), true);
  assert.equal(isQuotaError(new Error("The quota has been exceeded.")), true);
  assert.equal(isQuotaError(new Error("something else")), false);
});
