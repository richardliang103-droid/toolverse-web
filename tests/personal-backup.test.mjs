import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import {
  PERSONAL_BACKUP_FORMAT,
  PERSONAL_BACKUP_VERSION,
  PersonalBackupError,
  collectPersonalBackupSources,
  createPersonalBackupArchive,
  parsePersonalBackupManifest,
  personalBackupFileName,
  readPersonalBackupArchive,
  restorePersonalBackupWorkspace,
} from "../lib/personal-backup.ts";
import { mergePersonalToolsState } from "../lib/personal-tools.ts";

const validSlugs = ["qr-code", "text-cleaner", "pdf-toolkit"];
const exportedAt = new Date("2026-07-26T03:00:00.000Z");

function zipBlob(entries) {
  const archive = zipSync(entries, { level: 6 });
  const copy = new Uint8Array(archive.byteLength);
  copy.set(archive);
  return new Blob([copy.buffer], { type: "application/zip" });
}

function manifest(overrides = {}) {
  return {
    format: PERSONAL_BACKUP_FORMAT,
    version: PERSONAL_BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    personalTools: { favoriteSlugs: ["qr-code"], recentSlugs: ["text-cleaner"], trackRecent: true },
    workspace: [],
    ...overrides,
  };
}

test("備份：個人設定、二進位檔案與 Workspace 欄位可完整往返", async () => {
  const personalTools = {
    favoriteSlugs: ["qr-code", "missing"],
    recentSlugs: ["text-cleaner"],
    trackRecent: true,
  };
  const workspace = [{
    item: {
      id: "item-1",
      name: "照片 測試.png",
      mimeType: "image/png",
      sourceTool: "qr-code",
      createdAt: "2026-07-25T12:00:00.000Z",
      pinned: true,
      metadata: { handoffKind: "file", nested: { order: 1 } },
    },
    blob: new Blob([new Uint8Array([0, 1, 2, 255])], { type: "image/png" }),
  }];

  const archive = await createPersonalBackupArchive(personalTools, workspace, validSlugs, exportedAt);
  const restored = await readPersonalBackupArchive(archive, validSlugs);

  assert.equal(archive.type, "application/zip");
  assert.equal(restored.exportedAt, exportedAt.toISOString());
  assert.deepEqual(restored.personalTools, {
    favoriteSlugs: ["qr-code"],
    recentSlugs: ["text-cleaner"],
    trackRecent: true,
  });
  assert.equal(restored.totalBytes, 4);
  assert.equal(restored.workspace.length, 1);
  assert.equal(restored.workspace[0].name, "照片 測試.png");
  assert.equal(restored.workspace[0].pinned, true);
  assert.equal(restored.workspace[0].sourceTool, "qr-code");
  assert.deepEqual(restored.workspace[0].metadata, { handoffKind: "file", nested: { order: 1 } });
  assert.deepEqual([...new Uint8Array(await restored.workspace[0].blob.arrayBuffer())], [0, 1, 2, 255]);
});

test("備份清單：清理不存在的工具、危險 metadata key 與路徑字元", () => {
  const rawMetadata = JSON.parse('{"__proto__":"drop","ok":"keep"}');
  const parsed = parsePersonalBackupManifest(manifest({
    personalTools: {
      favoriteSlugs: ["missing", "pdf-toolkit"],
      recentSlugs: ["missing", "qr-code"],
      trackRecent: true,
    },
    workspace: [{
      backupId: "item-1",
      path: "files/000001",
      name: "../../report\n.pdf",
      mimeType: "application/pdf",
      sizeBytes: 0,
      sourceTool: "pdf-toolkit",
      createdAt: exportedAt.toISOString(),
      pinned: false,
      metadata: rawMetadata,
    }],
  }), validSlugs);

  assert.deepEqual(parsed.personalTools.favoriteSlugs, ["pdf-toolkit"]);
  assert.deepEqual(parsed.personalTools.recentSlugs, ["qr-code"]);
  assert.equal(parsed.workspace[0].name, "....report.pdf");
  assert.deepEqual(parsed.workspace[0].metadata, { ok: "keep" });
});

test("備份清單：拒絕不相容版本與路徑穿越", () => {
  assert.throws(
    () => parsePersonalBackupManifest(manifest({ version: 2 }), validSlugs),
    (error) => error instanceof PersonalBackupError && /版本不相容/.test(error.message),
  );
  assert.throws(
    () => parsePersonalBackupManifest(manifest({
      workspace: [{
        backupId: "item-1",
        path: "../secret",
        name: "a.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        sourceTool: null,
        createdAt: exportedAt.toISOString(),
        pinned: false,
        metadata: {},
      }],
    }), validSlugs),
    (error) => error instanceof PersonalBackupError && /清單損壞/.test(error.message),
  );
});

test("讀取備份：不是 ToolVerse ZIP 或缺少檔案內容時乾淨拒絕", async () => {
  const unrelated = zipBlob({ "hello.txt": strToU8("hello") });
  await assert.rejects(
    () => readPersonalBackupArchive(unrelated, validSlugs),
    (error) => error instanceof PersonalBackupError && /不是 ToolVerse/.test(error.message),
  );

  const missingManifest = manifest({
    workspace: [{
      backupId: "item-1",
      path: "files/000001",
      name: "missing.txt",
      mimeType: "text/plain",
      sizeBytes: 4,
      sourceTool: null,
      createdAt: exportedAt.toISOString(),
      pinned: false,
      metadata: {},
    }],
  });
  const missingFile = zipBlob({ "manifest.json": strToU8(JSON.stringify(missingManifest)) });
  await assert.rejects(
    () => readPersonalBackupArchive(missingFile, validSlugs),
    (error) => error instanceof PersonalBackupError && /缺少/.test(error.message),
  );
});

test("讀取備份：ZIP 內容大小與清單不符時拒絕", async () => {
  const badSizeManifest = manifest({
    workspace: [{
      backupId: "item-1",
      path: "files/000001",
      name: "wrong.txt",
      mimeType: "text/plain",
      sizeBytes: 4,
      sourceTool: null,
      createdAt: exportedAt.toISOString(),
      pinned: false,
      metadata: {},
    }],
  });
  const badSize = zipBlob({
    "manifest.json": strToU8(JSON.stringify(badSizeManifest)),
    "files/000001": strToU8("abc"),
  });
  await assert.rejects(
    () => readPersonalBackupArchive(badSize, validSlugs),
    (error) => error instanceof PersonalBackupError && /大小|內容損壞/.test(error.message),
  );
});

test("Workspace 備份：任一 Blob 遺失就停止，不產生殘缺備份", async () => {
  const items = [
    { id: "a", name: "a.txt" },
    { id: "b", name: "missing.txt" },
  ];
  await assert.rejects(
    () => collectPersonalBackupSources({
      async list() { return items; },
      async read(id) { return id === "a" ? new Blob(["a"]) : null; },
    }),
    (error) => error instanceof PersonalBackupError && /missing\.txt/.test(error.message),
  );
});

test("Workspace 還原：中途失敗會回滾這批已加入的項目", async () => {
  const removed = [];
  let nextId = 0;
  const entry = {
    backupId: "old-1",
    path: "files/000001",
    name: "a.txt",
    mimeType: "text/plain",
    sizeBytes: 1,
    sourceTool: "text-cleaner",
    createdAt: exportedAt.toISOString(),
    pinned: true,
    metadata: { handoffKind: "text" },
    blob: new Blob(["a"], { type: "text/plain" }),
  };
  const repository = {
    async save(input) {
      if (input.name === "b.txt") throw new Error("模擬空間不足");
      nextId += 1;
      return { id: `new-${nextId}` };
    },
    async remove(id) {
      removed.push(id);
      return true;
    },
  };

  await assert.rejects(
    () => restorePersonalBackupWorkspace(repository, [entry, { ...entry, backupId: "old-2", name: "b.txt" }]),
    /模擬空間不足/,
  );
  assert.deepEqual(removed, ["new-1"]);
});

test("合併個人設定：保留現有順序，且採較嚴格的隱私設定", () => {
  assert.deepEqual(mergePersonalToolsState(
    { favoriteSlugs: ["qr-code"], recentSlugs: ["text-cleaner"], trackRecent: true },
    { favoriteSlugs: ["pdf-toolkit", "qr-code"], recentSlugs: ["pdf-toolkit"], trackRecent: true },
    validSlugs,
  ), {
    favoriteSlugs: ["qr-code", "pdf-toolkit"],
    recentSlugs: ["text-cleaner", "pdf-toolkit"],
    trackRecent: true,
  });

  assert.deepEqual(mergePersonalToolsState(
    { favoriteSlugs: ["qr-code"], recentSlugs: ["text-cleaner"], trackRecent: true },
    { favoriteSlugs: ["pdf-toolkit"], recentSlugs: [], trackRecent: false },
    validSlugs,
  ), {
    favoriteSlugs: ["qr-code", "pdf-toolkit"],
    recentSlugs: [],
    trackRecent: false,
  });
});

test("備份檔名使用穩定日期格式", () => {
  assert.equal(personalBackupFileName(exportedAt), "toolverse-backup-2026-07-26.zip");
});
