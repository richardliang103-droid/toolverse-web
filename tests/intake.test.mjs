import assert from "node:assert/strict";
import test from "node:test";
import { detectFileType } from "../lib/intake/detect-file.ts";
import { detectTextType, looksLikeCsv, looksLikeJson } from "../lib/intake/detect-text.ts";
import { buildFileIntakeDetection, buildTextIntakeDetection, recommendToolsForFile, recommendToolsForText } from "../lib/intake/recommendations.ts";
import { FILE_SIGNATURES } from "../lib/intake/signatures.ts";
import { toolManifests, toolsAcceptingFile, toolsAcceptingText } from "../lib/tool-manifest.ts";

function bytesOf(...parts) {
  const encoder = new TextEncoder();
  const chunks = parts.map((part) => (typeof part === "string" ? encoder.encode(part) : Uint8Array.from(part)));
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

function textBytes(text) {
  return new TextEncoder().encode(text);
}

// ---------- detect-file: 二進位簽章 ----------

test("detectFileType：PNG／JPEG／PDF 的 magic bytes", () => {
  const png = detectFileType({ name: "a.png", declaredType: "image/png", bytes: bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "rest") });
  assert.equal(png.mimeType, "image/png");
  assert.equal(png.category, "image");
  assert.equal(png.source, "magic-bytes");
  assert.equal(png.mismatch, false);

  const jpeg = detectFileType({ name: "a.jpg", declaredType: "image/jpeg", bytes: bytesOf([0xff, 0xd8, 0xff, 0xe0], "rest") });
  assert.equal(jpeg.mimeType, "image/jpeg");
  assert.equal(jpeg.source, "magic-bytes");

  const pdf = detectFileType({ name: "a.pdf", declaredType: "application/pdf", bytes: bytesOf("%PDF-1.7\n...") });
  assert.equal(pdf.mimeType, "application/pdf");
  assert.equal(pdf.category, "pdf");
});

test("detectFileType：GIF／BMP／WebP／WAV／OGG／MP3／M4A 的 magic bytes", () => {
  assert.equal(detectFileType({ name: "a.gif", declaredType: "image/gif", bytes: bytesOf("GIF89a", "rest") }).mimeType, "image/gif");
  assert.equal(detectFileType({ name: "a.bmp", declaredType: "image/bmp", bytes: bytesOf("BM", [0, 0, 0, 0]) }).mimeType, "image/bmp");
  assert.equal(detectFileType({ name: "a.webp", declaredType: "image/webp", bytes: bytesOf("RIFF", [0, 0, 0, 0], "WEBP") }).mimeType, "image/webp");
  assert.equal(detectFileType({ name: "a.wav", declaredType: "audio/wav", bytes: bytesOf("RIFF", [0, 0, 0, 0], "WAVE") }).mimeType, "audio/wav");
  assert.equal(detectFileType({ name: "a.ogg", declaredType: "audio/ogg", bytes: bytesOf("OggS", "rest") }).mimeType, "audio/ogg");
  assert.equal(detectFileType({ name: "a.mp3", declaredType: "audio/mpeg", bytes: bytesOf("ID3", [3, 0, 0, 0]) }).mimeType, "audio/mpeg");
  // 沒有 ID3 標籤的 MP3：frame sync 是 0xFF 接著高 3 bit 全 1（0xFB & 0xE0 === 0xE0）。
  assert.equal(detectFileType({ name: "a.mp3", declaredType: "", bytes: bytesOf([0xff, 0xfb, 0x90, 0]) }).mimeType, "audio/mpeg");
  assert.equal(detectFileType({ name: "a.m4a", declaredType: "audio/mp4", bytes: bytesOf([0, 0, 0, 0x20], "ftypM4A ") }).mimeType, "audio/mp4");
});

// ---------- detect-file: 內容嗅探（純文字格式沒有固定開頭位元組） ----------

test("detectFileType：SVG／JSON／CSV 檔案靠內容判斷，不是靠副檔名", () => {
  const svg = detectFileType({ name: "icon.svg", declaredType: "image/svg+xml", bytes: textBytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>') });
  assert.equal(svg.mimeType, "image/svg+xml");
  assert.equal(svg.source, "text-content");

  const svgWithProlog = detectFileType({ name: "icon.svg", declaredType: "", bytes: textBytes('<?xml version="1.0"?>\n<svg></svg>') });
  assert.equal(svgWithProlog.mimeType, "image/svg+xml");

  const json = detectFileType({ name: "data.json", declaredType: "application/json", bytes: textBytes('{"a":1,"b":[1,2,3]}') });
  assert.equal(json.mimeType, "application/json");
  assert.equal(json.source, "text-content");

  const csv = detectFileType({ name: "data.csv", declaredType: "text/csv", bytes: textBytes("name,age\nAlice,30\nBob,25\n") });
  assert.equal(csv.mimeType, "text/csv");
  assert.equal(csv.source, "text-content");
});

// ---------- 反偽造：不能只信副檔名 ----------

test("detectFileType：真正的 JPEG 改名成 .png，依內容判斷是 JPEG 不是 PNG", () => {
  const detection = detectFileType({ name: "disguised.png", declaredType: "image/png", bytes: bytesOf([0xff, 0xd8, 0xff, 0xe0], "rest") });
  assert.equal(detection.mimeType, "image/jpeg");
  assert.equal(detection.category, "image");
  assert.equal(detection.source, "magic-bytes");
  assert.equal(detection.mismatch, true, "副檔名與實際內容不符時要標記 mismatch");
});

test("detectFileType：一般文字檔案改名成 .png，不會被判成高信心的 PNG", () => {
  const detection = detectFileType({ name: "not-a-photo.png", declaredType: "image/png", bytes: textBytes("這只是一段普通的文字，不是任何圖片格式。") });
  assert.notEqual(detection.source, "magic-bytes");
  assert.ok(detection.confidence < 0.6, `不該用高信心宣稱是 PNG，實際 confidence=${detection.confidence}`);
});

test("detectFileType：真的是 PNG，只是副檔名寫成 .txt，依內容判斷仍是 PNG", () => {
  const detection = detectFileType({ name: "mislabeled.txt", declaredType: "text/plain", bytes: bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "rest") });
  assert.equal(detection.mimeType, "image/png");
  assert.equal(detection.mismatch, true);
});

test("detectFileType：.jpeg 副檔名不算跟 .jpg 簽章不符", () => {
  const detection = detectFileType({ name: "photo.jpeg", declaredType: "image/jpeg", bytes: bytesOf([0xff, 0xd8, 0xff, 0xe0], "rest") });
  assert.equal(detection.mismatch, false);
});

test("detectFileType：完全判斷不出來就承認判斷不出來，不硬猜", () => {
  const detection = detectFileType({ name: "mystery.bin", declaredType: "", bytes: new Uint8Array([1, 2, 3, 4, 5]) });
  assert.equal(detection.category, "unknown");
  assert.equal(detection.confidence, 0);
});

// ---------- detect-text ----------

test("detectTextType：JSON", () => {
  assert.equal(detectTextType('{"name":"test","values":[1,2,3]}').type, "json");
  assert.equal(detectTextType("[1, 2, 3]").type, "json");
  // 長得像但其實不合法的 JSON 不該被誤判
  assert.notEqual(detectTextType("{not valid json").type, "json");
});

test("detectTextType：CSV／TSV", () => {
  const csv = detectTextType("name,age,city\nAlice,30,Taipei\nBob,25,Kaohsiung");
  assert.equal(csv.type, "csv");
  const tsv = detectTextType("name\tage\nAlice\t30\nBob\t25");
  assert.equal(tsv.type, "csv");
});

test("detectTextType：Markdown", () => {
  assert.equal(detectTextType("# 標題\n\n這是內容，附上 [連結](https://example.com)。").type, "markdown");
  assert.equal(detectTextType("```js\nconsole.log(1);\n```").type, "markdown");
  assert.equal(detectTextType("| a | b |\n| - | - |\n| 1 | 2 |\n**重點**在這裡").type, "markdown");
});

test("detectTextType：網址", () => {
  assert.equal(detectTextType("https://toolverse-web.vercel.app/tools/lottery").type, "url");
  assert.equal(detectTextType("  https://example.com  ").type, "url");
  assert.notEqual(detectTextType("看看這個 https://example.com 好用嗎").type, "url", "夾在句子裡的網址不算純網址");
});

test("detectTextType：Base64", () => {
  const encoded = Buffer.from("這是一段會被編碼成 Base64 的內容，長度要夠長才不會被誤判。").toString("base64");
  assert.equal(detectTextType(encoded).type, "base64");
  assert.notEqual(detectTextType("abc").type, "base64", "太短不該被判成 base64");
});

test("detectTextType：名單型文字", () => {
  const names = ["王小明", "陳小華", "李大同", "張三", "林美麗"].join("\n");
  assert.equal(detectTextType(names).type, "name-list");
});

test("detectTextType：日期清單", () => {
  const dates = ["2026-07-25", "2026-08-01", "2026-08-15", "2026-09-01"].join("\n");
  assert.equal(detectTextType(dates).type, "date-list");
});

test("detectTextType：Mermaid", () => {
  assert.equal(detectTextType("flowchart TD\nA-->B\nB-->C").type, "mermaid");
  assert.equal(detectTextType("sequenceDiagram\nAlice->>Bob: Hello").type, "mermaid");
});

test("detectTextType：一般段落是最後的保底", () => {
  const paragraph = "今天天氣很好，我們一起出去走走吧。這篇文章沒有任何特殊格式，純粹是一段話，用來測試一般文字的判斷結果。";
  assert.equal(detectTextType(paragraph).type, "paragraph");
});

test("detectTextType：空字串回傳 empty，信心是 0", () => {
  assert.deepEqual(detectTextType(""), { type: "empty", confidence: 0 });
  assert.deepEqual(detectTextType("   \n  "), { type: "empty", confidence: 0 });
});

test("looksLikeJson／looksLikeCsv：供 detect-file 重用的共用邏輯", () => {
  assert.equal(looksLikeJson('{"a":1}'), true);
  assert.equal(looksLikeJson("不是 JSON"), false);
  assert.equal(looksLikeCsv("a,b\n1,2\n3,4").matches, true);
  assert.equal(looksLikeCsv("只有一行").matches, false);
});

// ---------- recommendations：與 manifest 的一致性 ----------

test("FILE_PRIORITY／TEXT_PRIORITY 裡策展的 slug 都是真的已註冊工具", () => {
  // 用一輪常見格式把策展表整個跑過一次，確保裡面提到的 slug 都能在 manifest 找到，
  // 不會因為工具改名或下架而悄悄失效。
  const sampleFileDetections = [
    { mimeType: "image/png", category: "image", label: "PNG 圖片", extension: ".png", confidence: 1, source: "magic-bytes", mismatch: false },
    { mimeType: "application/pdf", category: "pdf", label: "PDF 文件", extension: ".pdf", confidence: 1, source: "magic-bytes", mismatch: false },
    { mimeType: "audio/mpeg", category: "audio", label: "MP3 音訊", extension: ".mp3", confidence: 1, source: "magic-bytes", mismatch: false },
    { mimeType: "text/csv", category: "csv", label: "CSV 表格", extension: ".csv", confidence: 1, source: "text-content", mismatch: false },
    { mimeType: "application/json", category: "json", label: "JSON 資料", extension: ".json", confidence: 1, source: "text-content", mismatch: false },
  ];
  const slugs = new Set(toolManifests.map((manifest) => manifest.slug));
  for (const detection of sampleFileDetections) {
    for (const item of recommendToolsForFile(detection).allTools) assert.ok(slugs.has(item.slug), `${item.slug} 不在 manifest`);
  }
  for (const type of ["json", "markdown", "url", "base64", "csv", "date-list", "name-list", "paragraph", "mermaid"]) {
    for (const item of recommendToolsForText({ type, confidence: 1 }).allTools) assert.ok(slugs.has(item.slug), `${item.slug} 不在 manifest`);
  }
});

test("recommendToolsForFile：只推薦 manifest 真的宣告吃得下這個格式的工具", () => {
  const detection = { mimeType: "image/png", category: "image", label: "PNG 圖片", extension: ".png", confidence: 1, source: "magic-bytes", mismatch: false };
  const declared = new Set(toolsAcceptingFile("image/png", ".png").map((manifest) => manifest.slug));
  const { recommendedTools, allTools } = recommendToolsForFile(detection);
  for (const item of allTools) assert.ok(declared.has(item.slug));
  assert.deepEqual(allTools.map((item) => item.slug).sort(), [...declared].sort());
  assert.ok(recommendedTools.length <= 3);
  // exif-cleaner 是策展表裡圖片格式的第一名（先處理隱私再談其他）。
  assert.equal(recommendedTools[0]?.slug, "exif-cleaner");
});

test("recommendToolsForFile：PDF 的相容工具都會正確回傳", () => {
  const detection = { mimeType: "application/pdf", category: "pdf", label: "PDF 文件", extension: ".pdf", confidence: 1, source: "magic-bytes", mismatch: false };
  const { recommendedTools } = recommendToolsForFile(detection);
  assert.deepEqual(recommendedTools.map((item) => item.slug), ["pdf-toolkit", "document-to-markdown"]);
});

test("recommendToolsForFile：判斷不出格式時完全不推薦", () => {
  const detection = { mimeType: "application/octet-stream", category: "unknown", label: "未知格式", extension: null, confidence: 0, source: "unknown", mismatch: false };
  assert.deepEqual(recommendToolsForFile(detection), { recommendedTools: [], allTools: [] });
});

test("recommendToolsForText：CSV／Markdown 有明確的策展推薦", () => {
  assert.deepEqual(recommendToolsForText({ type: "csv", confidence: 1 }).recommendedTools.map((item) => item.slug), ["csv-editor"]);
  assert.deepEqual(recommendToolsForText({ type: "markdown", confidence: 1 }).recommendedTools.map((item) => item.slug), ["markdown-editor", "text-cleaner"]);
});

test("recommendToolsForText：沒有策展命中時不硬推，但完整清單仍看得到", () => {
  const { recommendedTools, allTools } = recommendToolsForText({ type: "mermaid", confidence: 0.9 });
  assert.deepEqual(recommendedTools, []);
  assert.ok(allTools.length > 0, "「查看全部」仍要看得到所有接受文字的工具");
});

test("recommendToolsForText：空字串不推薦任何工具", () => {
  assert.deepEqual(recommendToolsForText({ type: "empty", confidence: 0 }), { recommendedTools: [], allTools: [] });
});

test("toolsAcceptingText 回傳的每個工具都出現在文字的完整清單裡", () => {
  const { allTools } = recommendToolsForText({ type: "paragraph", confidence: 0.5 });
  const allSlugs = new Set(allTools.map((item) => item.slug));
  for (const manifest of toolsAcceptingText()) assert.ok(allSlugs.has(manifest.slug), `${manifest.slug} 漏掉了`);
});

// ---------- 組合層 ----------

test("buildFileIntakeDetection／buildTextIntakeDetection：組出完整的 IntakeDetection", () => {
  const fileDetection = detectFileType({ name: "a.pdf", declaredType: "application/pdf", bytes: bytesOf("%PDF-1.7") });
  const fileIntake = buildFileIntakeDetection(fileDetection);
  assert.equal(fileIntake.kind, "file");
  assert.equal(fileIntake.type, "application/pdf");
  assert.equal(fileIntake.label, "PDF 文件");
  assert.deepEqual(fileIntake.recommendedTools.map((item) => item.slug), ["pdf-toolkit", "document-to-markdown"]);

  const textIntake = buildTextIntakeDetection(detectTextType("name,age\nAlice,30"));
  assert.equal(textIntake.kind, "text");
  assert.equal(textIntake.type, "csv");
  assert.equal(textIntake.label, "CSV／TSV 表格");
});

// ---------- 簽章表本身的完整性 ----------

test("FILE_SIGNATURES：每個簽章都有對應的 manifest 工具吃得下", () => {
  for (const signature of FILE_SIGNATURES) {
    const declared = toolsAcceptingFile(signature.mimeType, signature.extension);
    assert.ok(declared.length > 0, `${signature.mimeType} 沒有任何工具宣告吃得下，這個簽章是多餘的`);
  }
});
