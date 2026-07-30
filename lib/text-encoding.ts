export type TextEncodingPreference = "auto" | "utf-8" | "big5" | "windows-1252";
export type DetectedTextEncoding = "utf-8" | "utf-16le" | "utf-16be" | "big5" | "windows-1252";

export type DecodedText = {
  text: string;
  encoding: DetectedTextEncoding;
  source: "bom" | "heuristic" | "manual";
};

function hasPrefix(bytes: Uint8Array, prefix: number[]) {
  return prefix.every((value, index) => bytes[index] === value);
}

function stripPrefix(bytes: Uint8Array, length: number) {
  return bytes.slice(length);
}

function decode(bytes: Uint8Array, encoding: DetectedTextEncoding, fatal = false) {
  try {
    return { text: new TextDecoder(encoding, { fatal }).decode(bytes), valid: true };
  } catch {
    return { text: new TextDecoder(encoding).decode(bytes), valid: false };
  }
}

function replacementCount(text: string) {
  return [...text].filter((char) => char === "�").length;
}

function readableTextScore(text: string) {
  const cjkCount = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const replacementPenalty = replacementCount(text) * 12;
  const controlPenalty = (text.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g) ?? []).length * 3;
  return cjkCount * 3 - replacementPenalty - controlPenalty;
}

/**
 * Decode bytes from Excel／Windows exports without assuming that every file is UTF-8.
 *
 * "ANSI" is not one universal encoding. In Traditional Chinese Windows exports it
 * usually means Big5, so auto mode tries UTF-8 first and falls back to Big5 when the
 * byte sequence is not valid UTF-8. Users can explicitly select a codec when a file
 * has no BOM and the automatic guess is ambiguous.
 */
export function decodeTextBytes(bytes: Uint8Array, preference: TextEncodingPreference = "auto"): DecodedText {
  if (hasPrefix(bytes, [0xef, 0xbb, 0xbf])) {
    return { text: decode(stripPrefix(bytes, 3), "utf-8").text, encoding: "utf-8", source: "bom" };
  }
  if (hasPrefix(bytes, [0xff, 0xfe])) {
    return { text: decode(stripPrefix(bytes, 2), "utf-16le").text, encoding: "utf-16le", source: "bom" };
  }
  if (hasPrefix(bytes, [0xfe, 0xff])) {
    return { text: decode(stripPrefix(bytes, 2), "utf-16be").text, encoding: "utf-16be", source: "bom" };
  }

  if (preference !== "auto") {
    return { text: decode(bytes, preference, false).text, encoding: preference, source: "manual" };
  }

  const utf8 = decode(bytes, "utf-8", true);
  if (utf8.valid) return { text: utf8.text, encoding: "utf-8", source: "heuristic" };

  const big5 = decode(bytes, "big5", false);
  const windows1252 = decode(bytes, "windows-1252", false);
  const best = readableTextScore(big5.text) >= readableTextScore(windows1252.text) ? big5 : windows1252;
  return {
    text: best.text,
    encoding: best === big5 ? "big5" : "windows-1252",
    source: "heuristic",
  };
}

export function encodingLabel(encoding: DetectedTextEncoding | null) {
  if (encoding === "utf-8") return "UTF-8";
  if (encoding === "utf-16le") return "UTF-16 LE";
  if (encoding === "utf-16be") return "UTF-16 BE";
  if (encoding === "big5") return "Big5／ANSI 繁中";
  if (encoding === "windows-1252") return "Windows-1252／ANSI 西文";
  return "尚未開啟檔案";
}
