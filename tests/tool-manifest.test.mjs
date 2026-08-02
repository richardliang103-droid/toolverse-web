import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import {
  PRIVACY_LABELS,
  getToolManifest,
  toolManifests,
  toolsAcceptingFile,
  toolsAcceptingHandoff,
  toolsAcceptingText,
  validateToolManifests,
} from "../lib/tool-manifest.ts";
import { tools } from "../lib/tools.ts";
import { sitePaths } from "../lib/site.ts";

/** manifest 的一份合法樣本，負面測試用來改壞單一欄位。 */
function sample(overrides = {}) {
  return {
    slug: "sample-tool",
    name: "樣本",
    description: "測試用的工具描述。",
    category: "utility",
    symbol: "◇",
    accent: "blue",
    status: "active",
    processing: "local",
    engines: ["native"],
    inputs: [{ kind: "text" }],
    outputs: [{ kind: "text" }],
    supportsBatch: false,
    supportsWorkspace: false,
    supportsRecipe: false,
    supportsOffline: true,
    handoff: { canSend: false, canReceive: false, kinds: [] },
    suggestedNextTools: [],
    privacy: "local-only",
    privacyNote: "只在本機處理。",
    ...overrides,
  };
}

test("正式 manifest 通過完整驗證", () => {
  assert.deepEqual(validateToolManifests(), []);
});

test("每個 manifest 都有對應的路由，每個路由也都有 manifest", () => {
  const routes = readdirSync(new URL("../app/tools", import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const slugs = toolManifests.map((manifest) => manifest.slug);

  for (const slug of slugs) {
    assert.ok(routes.includes(slug), `manifest 有 ${slug}，但 app/tools/${slug} 不存在`);
  }
  for (const route of routes) {
    assert.ok(slugs.includes(route), `app/tools/${route} 沒有登記在 manifest`);
  }
  assert.equal(routes.length, slugs.length);
});

test("卡片視圖與 manifest 一對一，順序相同", () => {
  assert.equal(tools.length, toolManifests.length);
  assert.deepEqual(tools.map((tool) => tool.slug), toolManifests.map((manifest) => manifest.slug));
  for (const tool of tools) {
    const manifest = getToolManifest(tool.slug);
    assert.ok(manifest, `${tool.slug} 找不到 manifest`);
    assert.equal(tool.name, manifest.name);
    assert.equal(tool.description, manifest.description);
    assert.equal(tool.symbol, manifest.symbol);
    assert.equal(tool.accent, manifest.accent);
    assert.equal(tool.category, manifest.category);
  }
});

test("status 對照到既有的卡片標籤字面值", () => {
  assert.equal(tools.find((tool) => tool.slug === "lottery")?.status, "READY");
  assert.equal(tools.find((tool) => tool.slug === "gantt")?.status, "BETA");
});

test("sitemap 涵蓋首頁與每一個 manifest 工具", () => {
  const paths = sitePaths().map((entry) => entry.path);
  assert.equal(paths.length, toolManifests.length + 1);
  assert.ok(paths.includes("/"));
  for (const manifest of toolManifests) {
    assert.ok(paths.includes(`/tools/${manifest.slug}`), `sitemap 缺少 ${manifest.slug}`);
  }
});

test("每個隱私層級都有給使用者看的說法", () => {
  for (const manifest of toolManifests) {
    assert.ok(PRIVACY_LABELS[manifest.privacy], `${manifest.slug} 的隱私標示沒有對應文案`);
  }
});

test("股權架構圖與營運架構圖互相推薦，方便完成企業徵信的兩種視角", () => {
  assert.deepEqual(getToolManifest("equity-chart")?.suggestedNextTools, ["operations-chart"]);
  assert.deepEqual(getToolManifest("operations-chart")?.suggestedNextTools, ["equity-chart"]);
});

test("驗證會抓到重複的 slug", () => {
  const problems = validateToolManifests([sample(), sample({ name: "另一個" })]);
  assert.ok(problems.some((problem) => problem.includes("slug 重複")), problems.join("\n"));
});

test("驗證會抓到不存在的 suggestedNextTools", () => {
  const problems = validateToolManifests([sample({ suggestedNextTools: ["does-not-exist"] })]);
  assert.ok(problems.some((problem) => problem.includes("does-not-exist")), problems.join("\n"));
});

test("驗證會抓到指向自己的 suggestedNextTools", () => {
  const problems = validateToolManifests([sample({ suggestedNextTools: ["sample-tool"] })]);
  assert.ok(problems.some((problem) => problem.includes("不可指向自己")), problems.join("\n"));
});

test("驗證會抓到「宣稱本機卻用遠端 API」的隱私矛盾", () => {
  const problems = validateToolManifests([sample({ engines: ["native", "remote-api"] })]);
  assert.ok(problems.some((problem) => problem.includes("remote-api engine")), problems.join("\n"));
});

test("驗證會抓到「宣稱會連線卻標成完全本機」", () => {
  const problems = validateToolManifests([sample({ processing: "remote", engines: ["remote-api"], supportsOffline: false })]);
  assert.ok(problems.some((problem) => problem.includes("privacy 必須是 third-party")), problems.join("\n"));
});

test("驗證會抓到「要連線卻宣稱可離線」", () => {
  const problems = validateToolManifests([
    sample({ processing: "hybrid", engines: ["native", "remote-api"], privacy: "conditional", supportsOffline: true }),
  ]);
  assert.ok(problems.some((problem) => problem.includes("supportsOffline")), problems.join("\n"));
});

test("驗證會抓到 supportsBatch 與 maxFiles 不一致", () => {
  const single = validateToolManifests([
    sample({ inputs: [{ kind: "file", mimeTypes: ["image/png"], maxFiles: 1 }], supportsBatch: true }),
  ]);
  assert.ok(single.some((problem) => problem.includes("supportsBatch")), single.join("\n"));

  const many = validateToolManifests([
    sample({ inputs: [{ kind: "file", mimeTypes: ["image/png"], maxFiles: 10 }], supportsBatch: false }),
  ]);
  assert.ok(many.some((problem) => problem.includes("supportsBatch")), many.join("\n"));
});

test("驗證會抓到 file 能力省略 maxFiles（依文件語意代表沒有上限）卻宣告 supportsBatch 為 false 的矛盾", () => {
  const omitted = validateToolManifests([
    sample({ inputs: [{ kind: "file", mimeTypes: ["text/csv"] }], supportsBatch: false }),
  ]);
  assert.ok(omitted.some((problem) => problem.includes("maxFiles")), omitted.join("\n"));

  // 明確標上 maxFiles（即使是 1）就不算矛盾，只有「省略」才代表宣告不上限。
  const explicit = validateToolManifests([
    sample({ inputs: [{ kind: "file", mimeTypes: ["text/csv"], maxFiles: 1 }], supportsBatch: false }),
  ]);
  assert.deepEqual(explicit, []);
});

test("驗證會抓到沒有宣告格式的檔案輸入", () => {
  const problems = validateToolManifests([sample({ inputs: [{ kind: "file" }] })]);
  assert.ok(problems.some((problem) => problem.includes("mimeTypes")), problems.join("\n"));
});

test("toolsAcceptingFile：依 MIME 找得到吃這個格式的工具", () => {
  const jpeg = toolsAcceptingFile("image/jpeg").map((manifest) => manifest.slug);
  for (const slug of ["exif-cleaner", "image-compressor", "image-converter", "image-crop", "background-remover"]) {
    assert.ok(jpeg.includes(slug), `image/jpeg 應該推薦 ${slug}`);
  }
  assert.ok(!jpeg.includes("text-cleaner"));

  assert.deepEqual(toolsAcceptingFile("application/pdf").map((manifest) => manifest.slug), ["pdf-toolkit"]);
  assert.deepEqual(toolsAcceptingFile("", ".tsv").map((manifest) => manifest.slug), ["csv-editor"]);
  assert.deepEqual(toolsAcceptingFile("application/x-unknown").map((manifest) => manifest.slug), []);
});

test("toolsAcceptingText：文字鏈的工具都在裡面", () => {
  const slugs = toolsAcceptingText().map((manifest) => manifest.slug);
  for (const slug of ["text-cleaner", "chinese-converter", "text-compare", "markdown-editor"]) {
    assert.ok(slugs.includes(slug), `${slug} 應該收文字`);
  }
  assert.ok(!slugs.includes("pdf-toolkit"));
});

function sourceForTool(slug) {
  const directory = new URL(`../app/tools/${slug}/`, import.meta.url);
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => readFileSync(new URL(entry.name, directory), "utf8"))
    .join("\n");
}

test("handoff manifest 與工具頁的實際 hook／按鈕一致", () => {
  for (const manifest of toolManifests) {
    const source = sourceForTool(manifest.slug);
    const canReceiveFile = /\buseHandoff(?:Files)?\s*\(/.test(source);
    const canReceiveText = /\buseTextHandoff\s*\(/.test(source);
    const canSend = /<SendToTools\b/.test(source);
    const kinds = [
      ...(canReceiveFile || /\bgetFiles?\s*=/.test(source) ? ["file"] : []),
      ...(canReceiveText || /\bgetText\s*=/.test(source) ? ["text"] : []),
    ];

    assert.equal(manifest.handoff.canReceive, canReceiveFile || canReceiveText, `${manifest.slug} canReceive 漂移`);
    assert.equal(manifest.handoff.canSend, canSend, `${manifest.slug} canSend 漂移`);
    assert.deepEqual([...manifest.handoff.kinds].sort(), kinds.sort(), `${manifest.slug} handoff kinds 漂移`);
  }
});

test("Workspace manifest 與工具頁的實際儲存按鈕一致", () => {
  for (const manifest of toolManifests) {
    const source = sourceForTool(manifest.slug);
    const canSaveToWorkspace = /<SaveToWorkspace\b/.test(source);
    assert.equal(manifest.supportsWorkspace, canSaveToWorkspace, `${manifest.slug} supportsWorkspace 漂移`);
  }
});

test("接力目標由 manifest 的 canReceive 與 kind 推導", () => {
  assert.deepEqual(
    toolsAcceptingHandoff("file").map((manifest) => manifest.slug),
    ["background-remover", "image-compressor", "exif-cleaner", "image-crop", "image-converter"],
  );
  assert.deepEqual(
    toolsAcceptingHandoff("text").map((manifest) => manifest.slug),
    ["text-cleaner", "chinese-converter", "text-compare", "markdown-editor", "subtitle-editor"],
  );
});
