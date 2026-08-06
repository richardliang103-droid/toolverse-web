import assert from "node:assert/strict";
import test from "node:test";
import {
  SUPPORTED_DOCUMENT_EXTENSIONS,
  documentMarkdownFilename,
  documentFormatForFilename,
  isSupportedDocument,
  userFacingConversionError,
} from "../lib/document-to-markdown.ts";

test("支援的文件副檔名會被接受，大小寫與 MIME 缺失不影響判斷", () => {
  assert.equal(isSupportedDocument({ name: "報告.DOCX", type: "" }), true);
  assert.equal(isSupportedDocument({ name: "試算表.xlsx", type: "application/octet-stream" }), true);
  assert.equal(isSupportedDocument({ name: "簡報.pptx", type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }), true);
  assert.equal(isSupportedDocument({ name: "照片.png", type: "image/png" }), false);
  assert.ok(SUPPORTED_DOCUMENT_EXTENSIONS.includes(".pdf"));
});

test("副檔名會映射到 anydoc 可辨識的容器格式", () => {
  assert.equal(documentFormatForFilename("資料.csv"), "csv");
  assert.equal(documentFormatForFilename("舊版.xls"), "xlsx");
  assert.equal(documentFormatForFilename("簡報.pptm"), "pptx");
  assert.equal(documentFormatForFilename("報告.docm"), "doc");
  assert.equal(documentFormatForFilename("未知.txt"), undefined);
});

test("輸出檔名保留原始檔名並改成 md", () => {
  assert.equal(documentMarkdownFilename("研究報告.docx"), "研究報告.md");
  assert.equal(documentMarkdownFilename("無副檔名"), "無副檔名.md");
  assert.equal(documentMarkdownFilename("報告."), "報告.md");
});

test("anydoc 錯誤碼轉成可理解的繁中文案", () => {
  assert.equal(userFacingConversionError({ code: "unsupported" }), "這份檔案格式不支援，或沒有可擷取的文字內容。掃描 PDF 需要 OCR。");
  assert.equal(userFacingConversionError({ code: "encrypted" }), "檔案有密碼或已加密，無法轉換。");
  assert.equal(userFacingConversionError({ code: "resourceLimit" }), "檔案結構或大小超過安全限制，請改用較小的檔案。");
  assert.equal(userFacingConversionError({ code: "unknown" }), "轉換失敗，請確認檔案沒有損壞或改用其他格式。");
});
