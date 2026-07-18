import assert from "node:assert/strict";
import test from "node:test";
import { cleanedFilename, isJpeg, isPng, stripImageMetadata, stripJpegMetadata, stripPngMetadata } from "../lib/exif-clean.ts";

function jpegSegment(marker, payload) {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
}

/** 合成一個結構正確的 JPEG segment 流（不需要能被解碼，只要能被走訪）。 */
function makeJpeg({ withExif = true, withComment = true } = {}) {
  const bytes = [0xff, 0xd8]; // SOI
  bytes.push(...jpegSegment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00])); // APP0 JFIF
  if (withExif) bytes.push(...jpegSegment(0xe1, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 1, 2, 3, 4, 5, 6, 7, 8])); // APP1 Exif
  bytes.push(...jpegSegment(0xe2, [0x49, 0x43, 0x43, 0x00])); // APP2 ICC（要保留）
  if (withComment) bytes.push(...jpegSegment(0xfe, [0x68, 0x69])); // COM
  bytes.push(...jpegSegment(0xdb, [0x01, 0x02])); // DQT
  bytes.push(0xff, 0xda, 0x00, 0x04, 0x00, 0x00, 0xaa, 0xbb, 0xcc, 0xff, 0xd9); // SOS + 影像資料 + EOI
  return new Uint8Array(bytes);
}

function pngChunk(type, payload) {
  const bytes = [
    (payload.length >> 24) & 0xff, (payload.length >> 16) & 0xff, (payload.length >> 8) & 0xff, payload.length & 0xff,
    ...[...type].map((char) => char.charCodeAt(0)),
    ...payload,
    0, 0, 0, 0, // CRC（不驗證）
  ];
  return bytes;
}

function makePng({ withText = true, withExif = true } = {}) {
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  bytes.push(...pngChunk("IHDR", new Array(13).fill(1)));
  if (withText) bytes.push(...pngChunk("tEXt", [0x41, 0x00, 0x42]));
  if (withExif) bytes.push(...pngChunk("eXIf", [1, 2, 3, 4]));
  bytes.push(...pngChunk("IDAT", [9, 9, 9, 9, 9]));
  bytes.push(...pngChunk("IEND", []));
  return new Uint8Array(bytes);
}

test("jpeg: strips EXIF and comments, keeps JFIF/ICC and image data", () => {
  const source = makeJpeg();
  const { cleaned, removed } = stripJpegMetadata(source);
  assert.equal(removed.length, 2);
  assert.match(removed[0].label, /EXIF/);
  assert.ok(cleaned.length < source.length);
  assert.ok(isJpeg(cleaned));
  // 清過的檔案再清一次應該什麼都不用移除，且位元組完全相同（無損、冪等）
  const second = stripJpegMetadata(cleaned);
  assert.equal(second.removed.length, 0);
  assert.deepEqual([...second.cleaned], [...cleaned]);
  // 影像資料（SOS 之後）原樣保留
  assert.deepEqual([...cleaned.slice(-5)], [0xaa, 0xbb, 0xcc, 0xff, 0xd9]);
});

test("jpeg: rejects malformed streams instead of guessing", () => {
  assert.throws(() => stripJpegMetadata(new Uint8Array([0x00, 0x01, 0x02])), /不是有效的 JPEG/);
  const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x00]); // 長度爆表
  assert.throws(() => stripJpegMetadata(truncated), /結構異常/);
});

test("png: strips text/exif chunks, keeps IHDR/IDAT/IEND", () => {
  const source = makePng();
  const { cleaned, removed } = stripPngMetadata(source);
  assert.equal(removed.length, 2);
  assert.ok(isPng(cleaned));
  const text = String.fromCharCode(...cleaned);
  assert.ok(text.includes("IHDR") && text.includes("IDAT") && text.includes("IEND"));
  assert.ok(!text.includes("tEXt") && !text.includes("eXIf"));
  const second = stripPngMetadata(cleaned);
  assert.equal(second.removed.length, 0);
});

test("dispatcher picks format and rejects unknown bytes", () => {
  assert.equal(stripImageMetadata(makeJpeg()).removed.length, 2);
  assert.equal(stripImageMetadata(makePng()).removed.length, 2);
  assert.throws(() => stripImageMetadata(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])), /支援 JPG 與 PNG/);
});

test("cleaned filename keeps the extension", () => {
  assert.equal(cleanedFilename("photo.jpg"), "photo-clean.jpg");
  assert.equal(cleanedFilename("多層.名字.png"), "多層.名字-clean.png");
  assert.equal(cleanedFilename("noext"), "noext-clean");
});
