/**
 * 字幕解析與序列化 —— SRT／VTT 的純函式核心。
 *
 * 零依賴、無瀏覽器 API，可用 `node --test --experimental-strip-types` 直接跑，
 * UI（`app/tools/subtitle-editor/`）只負責畫面與檔案 I/O，所有格式知識都在這裡。
 *
 * 兩種格式的差異只有三處，其餘都共用：
 * - 毫秒分隔符：SRT 是逗號 `00:00:01,500`，VTT 是句點 `00:00:01.500`。
 * - VTT 一定有 `WEBVTT` 標頭，且每段前面可以有一行「cue 識別字」與時間碼後
 *   的 cue 設定（`align:start` 之類）；SRT 只有遞增的整數序號。
 * - VTT 允許省略小時（`01:30.500`），SRT 慣例一定寫滿 `HH:MM:SS`。
 *
 * 解析失敗一律丟 `SubtitleParseError`（帶行號），不靜默跳過壞掉的段落——
 * 字幕差一段就會整片對不上，默默吞掉比報錯更難查。
 */

export type SubtitleFormat = "srt" | "vtt";

export interface SubtitleCue {
  /** 顯示用序號，從 1 開始。序列化時一律重新編號，不信任來源檔的編號。 */
  index: number;
  startMs: number;
  endMs: number;
  /** 字幕內容，可以有換行（多行字幕）。 */
  text: string;
  /** VTT 的可選 cue 識別字；SRT 沒有這個概念，轉成 SRT 時會捨棄。 */
  id?: string;
  /** VTT 時間碼後的 cue 設定（`align:start line:90%`）；轉成 SRT 時會捨棄。 */
  settings?: string;
}

/** 解析錯誤一律帶行號，使用者才知道要去修哪一行。 */
export class SubtitleParseError extends Error {
  /** 出問題的行號（從 1 開始）；0 代表與特定行無關。 */
  readonly line: number;

  constructor(message: string, line = 0) {
    super(line > 0 ? `第 ${line} 行：${message}` : message);
    this.name = "SubtitleParseError";
    this.line = line;
  }
}

const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_SECOND = 1000;
const ARROW = "-->";

/** `HH:MM:SS,mmm`、`HH:MM:SS.mmm` 與 VTT 允許的 `MM:SS.mmm`。毫秒接受 1～3 位。 */
const TIMECODE_PATTERN = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/;

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** 時間軸沒有負數；偏移或縮放把時間推到 0 之前時一律夾到 0。 */
function clampMs(value: number): number {
  return value > 0 ? Math.round(value) : 0;
}

/**
 * 毫秒轉時間碼。負數夾到 0，小數先四捨五入再進位，
 * 所以 999.6 ms 會變成 `00:00:01,000` 而不是 `00:00:00,1000`。
 */
export function formatTimecode(totalMs: number, format: SubtitleFormat = "srt"): string {
  if (!Number.isFinite(totalMs)) throw new TypeError("時間必須是有限的數字（毫秒）");
  const ms = clampMs(totalMs);
  const separator = format === "srt" ? "," : ".";
  return [
    pad(Math.floor(ms / MS_PER_HOUR), 2),
    pad(Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE), 2),
    pad(Math.floor((ms % MS_PER_MINUTE) / MS_PER_SECOND), 2),
  ].join(":") + separator + pad(ms % MS_PER_SECOND, 3);
}

/** 時間碼轉毫秒。兩種毫秒分隔符都吃，`01:30.500` 這種省略小時的 VTT 寫法也吃。 */
export function parseTimecode(value: string, line = 0): number {
  const match = TIMECODE_PATTERN.exec(value.trim());
  if (!match) {
    throw new SubtitleParseError(`無法解析時間碼「${value.trim()}」，預期格式為 00:00:01,500（SRT）或 00:00:01.500（VTT）`, line);
  }
  const [, hours = "0", minutes, seconds, fraction] = match;
  if (Number(minutes) > 59) throw new SubtitleParseError(`時間碼「${value.trim()}」的分鐘超過 59`, line);
  if (Number(seconds) > 59) throw new SubtitleParseError(`時間碼「${value.trim()}」的秒數超過 59`, line);
  // 毫秒不足三位是右補零：`,5` 是 500 ms，不是 5 ms。
  return Number(hours) * MS_PER_HOUR
    + Number(minutes) * MS_PER_MINUTE
    + Number(seconds) * MS_PER_SECOND
    + Number(fraction.padEnd(3, "0"));
}

/** 去掉 BOM 並統一換行，之後所有解析都以「行陣列」為單位，好回報行號。 */
function toLines(input: string): string[] {
  return input.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
}

type Timing = { startMs: number; endMs: number; settings?: string };

/** 解析 `00:00:01,000 --> 00:00:04,000 align:start` 這一行。 */
function parseTimingLine(raw: string, line: number): Timing {
  const arrowAt = raw.indexOf(ARROW);
  if (arrowAt < 0) throw new SubtitleParseError(`時間碼那行缺少「${ARROW}」：「${raw.trim()}」`, line);
  const startMs = parseTimecode(raw.slice(0, arrowAt), line);
  // 箭號右邊除了結束時間，還可能跟著 VTT 的 cue 設定，用空白切開。
  const rest = raw.slice(arrowAt + ARROW.length).trim();
  const [endText = "", ...settingsParts] = rest.split(/\s+/);
  const endMs = parseTimecode(endText, line);
  const settings = settingsParts.join(" ");
  return settings === "" ? { startMs, endMs } : { startMs, endMs, settings };
}

/** 從 `at` 開始往下收字幕內容，收到空行或檔尾為止，回傳內容與下一個起點。 */
function collectText(lines: readonly string[], at: number): { text: string; next: number } {
  const payload: string[] = [];
  let cursor = at;
  while (cursor < lines.length && lines[cursor].trim() !== "") {
    payload.push(lines[cursor]);
    cursor += 1;
  }
  return { text: payload.join("\n").trimEnd(), next: cursor };
}

function skipBlank(lines: readonly string[], at: number): number {
  let cursor = at;
  while (cursor < lines.length && lines[cursor].trim() === "") cursor += 1;
  return cursor;
}

/**
 * 解析 SRT。
 *
 * 每一段是「序號 → 時間碼 → 一到多行內容 → 空行」。序號在真實檔案裡常常
 * 有缺漏或亂跳，所以只當提示用，實際編號由 `renumberCues()` 重排。
 */
export function parseSrt(input: string): SubtitleCue[] {
  const lines = toLines(input);
  const cues: SubtitleCue[] = [];
  let at = skipBlank(lines, 0);

  while (at < lines.length) {
    const first = lines[at].trim();
    let timingAt = at;
    if (/^\d+$/.test(first)) {
      timingAt = at + 1;
      if (timingAt >= lines.length || lines[timingAt].trim() === "") {
        throw new SubtitleParseError(`字幕序號「${first}」後面缺少時間碼`, at + 1);
      }
    } else if (!first.includes(ARROW)) {
      throw new SubtitleParseError(`預期是字幕序號或時間碼，卻讀到「${first}」`, at + 1);
    }

    const timing = parseTimingLine(lines[timingAt], timingAt + 1);
    const { text, next } = collectText(lines, timingAt + 1);
    cues.push({ index: cues.length + 1, startMs: timing.startMs, endMs: timing.endMs, text });
    at = skipBlank(lines, next);
  }

  return cues;
}

/** NOTE／STYLE／REGION 這些非字幕區塊要整段跳過，不能當成 cue。 */
const VTT_BLOCK_KEYWORDS = ["NOTE", "STYLE", "REGION"];

function isVttMetadataBlock(first: string): boolean {
  return VTT_BLOCK_KEYWORDS.some((keyword) => first === keyword || first.startsWith(`${keyword} `));
}

/**
 * 解析 WebVTT。
 *
 * 與 SRT 的差別：一定要有 `WEBVTT` 標頭、cue 前面可以有一行識別字、
 * 時間碼後面可以有 cue 設定，另外還有 NOTE／STYLE／REGION 這些非字幕區塊。
 */
export function parseVtt(input: string): SubtitleCue[] {
  const lines = toLines(input);
  const headerAt = skipBlank(lines, 0);
  if (headerAt >= lines.length) return [];
  const header = lines[headerAt].trim();
  if (header !== "WEBVTT" && !header.startsWith("WEBVTT ") && !header.startsWith("WEBVTT\t")) {
    throw new SubtitleParseError(`WebVTT 檔案的第一行必須是 WEBVTT，卻讀到「${header}」`, headerAt + 1);
  }

  const cues: SubtitleCue[] = [];
  // 標頭之後可能還有幾行 metadata（`Kind: captions`…），一路跳到第一個空行。
  let at = skipBlank(lines, collectText(lines, headerAt).next);

  while (at < lines.length) {
    const first = lines[at].trim();
    if (isVttMetadataBlock(first)) {
      at = skipBlank(lines, collectText(lines, at).next);
      continue;
    }

    let id: string | undefined;
    let timingAt = at;
    if (!first.includes(ARROW)) {
      // 不含箭號代表這行是 cue 識別字，時間碼在下一行。
      id = first;
      timingAt = at + 1;
      if (timingAt >= lines.length || lines[timingAt].trim() === "") {
        throw new SubtitleParseError(`cue 識別字「${first}」後面缺少時間碼`, at + 1);
      }
    }

    const timing = parseTimingLine(lines[timingAt], timingAt + 1);
    const { text, next } = collectText(lines, timingAt + 1);
    cues.push({
      index: cues.length + 1,
      startMs: timing.startMs,
      endMs: timing.endMs,
      text,
      ...(id === undefined ? {} : { id }),
      ...(timing.settings === undefined ? {} : { settings: timing.settings }),
    });
    at = skipBlank(lines, next);
  }

  return cues;
}

/** 靠 `WEBVTT` 標頭判斷格式；沒有標頭就當 SRT。 */
export function detectSubtitleFormat(input: string): SubtitleFormat {
  return /^\uFEFF?\s*WEBVTT\b/.test(input) ? "vtt" : "srt";
}

/** 不確定來源格式時用這個：自動判斷並回報實際使用的解析器。 */
export function parseSubtitle(input: string): { format: SubtitleFormat; cues: SubtitleCue[] } {
  const format = detectSubtitleFormat(input);
  return { format, cues: format === "vtt" ? parseVtt(input) : parseSrt(input) };
}

/** 重新編號，讓序號永遠是連續的 1、2、3…。 */
export function renumberCues(cues: readonly SubtitleCue[]): SubtitleCue[] {
  return cues.map((cue, at) => ({ ...cue, index: at + 1 }));
}

export function toSrt(cues: readonly SubtitleCue[]): string {
  if (cues.length === 0) return "";
  const blocks = cues.map((cue, at) =>
    `${at + 1}\n${formatTimecode(cue.startMs, "srt")} ${ARROW} ${formatTimecode(cue.endMs, "srt")}\n${cue.text}`);
  return `${blocks.join("\n\n")}\n`;
}

export function toVtt(cues: readonly SubtitleCue[]): string {
  const blocks = cues.map((cue) => {
    const settings = cue.settings === undefined || cue.settings === "" ? "" : ` ${cue.settings}`;
    const identifier = cue.id === undefined || cue.id === "" ? "" : `${cue.id}\n`;
    return `${identifier}${formatTimecode(cue.startMs, "vtt")} ${ARROW} ${formatTimecode(cue.endMs, "vtt")}${settings}\n${cue.text}`;
  });
  return blocks.length === 0 ? "WEBVTT\n" : `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

/** 依格式序列化，省得呼叫端自己分支。 */
export function serializeCues(cues: readonly SubtitleCue[], format: SubtitleFormat): string {
  return format === "vtt" ? toVtt(cues) : toSrt(cues);
}

/**
 * 整體平移時間碼，用來修音畫不同步。正數往後、負數往前，支援小數秒。
 * 平移到 0 之前的部分一律夾到 0（時間軸沒有負數）。
 */
export function shiftCues(cues: readonly SubtitleCue[], offsetSeconds: number): SubtitleCue[] {
  if (!Number.isFinite(offsetSeconds)) throw new TypeError("偏移秒數必須是有限的數字");
  const offsetMs = Math.round(offsetSeconds * MS_PER_SECOND);
  return cues.map((cue) => ({
    ...cue,
    startMs: clampMs(cue.startMs + offsetMs),
    endMs: clampMs(cue.endMs + offsetMs),
  }));
}

/**
 * 依倍率縮放時間碼，用來修「越後面差越多」的漸進偏差（換算影格率造成的）。
 * 倍率必須大於 0；等於 1 代表不變。
 */
export function scaleCues(cues: readonly SubtitleCue[], factor: number): SubtitleCue[] {
  if (!Number.isFinite(factor) || factor <= 0) throw new RangeError("縮放倍率必須是大於 0 的數字");
  return cues.map((cue) => ({
    ...cue,
    startMs: clampMs(cue.startMs * factor),
    endMs: clampMs(cue.endMs * factor),
  }));
}

/**
 * 影格率換算的倍率：來源影格率 ÷ 目標影格率。
 *
 * 23.976 fps 的字幕拿到 25 fps 的影片上播放時，畫面跑得比較快，
 * 時間碼要乘以 23.976 / 25 ≈ 0.95904 才追得上。
 */
export function frameRateFactor(sourceFps: number, targetFps: number): number {
  if (!Number.isFinite(sourceFps) || sourceFps <= 0) throw new RangeError("來源影格率必須是大於 0 的數字");
  if (!Number.isFinite(targetFps) || targetFps <= 0) throw new RangeError("目標影格率必須是大於 0 的數字");
  return sourceFps / targetFps;
}

/** 合併間隔在 `maxGapMs` 以內的相鄰字幕，內容用換行接起來。 */
export function mergeAdjacentCues(cues: readonly SubtitleCue[], maxGapMs = 0): SubtitleCue[] {
  if (!Number.isFinite(maxGapMs) || maxGapMs < 0) throw new RangeError("合併間隔必須是 0 或正數（毫秒）");
  const merged: SubtitleCue[] = [];
  for (const cue of cues) {
    const previous = merged.at(-1);
    if (previous && cue.startMs - previous.endMs <= maxGapMs) {
      merged[merged.length - 1] = {
        ...previous,
        endMs: Math.max(previous.endMs, cue.endMs),
        text: [previous.text, cue.text].filter((part) => part !== "").join("\n"),
      };
      continue;
    }
    merged.push({ ...cue });
  }
  return renumberCues(merged);
}

/** 依時間範圍篩選：只要與範圍有重疊就保留（不要求整段落在範圍內）。 */
export function filterCuesByRange(cues: readonly SubtitleCue[], startMs: number, endMs: number): SubtitleCue[] {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) throw new TypeError("篩選範圍必須是有限的數字（毫秒）");
  if (endMs < startMs) throw new RangeError("篩選的結束時間不可早於開始時間");
  return renumberCues(cues.filter((cue) => cue.endMs > startMs && cue.startMs < endMs));
}

/** 去掉 `<i>` 這類標記與 `{\an8}` 這類 ASS 樣式碼，逐字稿才不會夾雜語法。 */
export function stripCueTags(text: string): string {
  return text.replace(/<[^>]*>/g, "").replace(/\{[^}]*\}/g, "");
}

/**
 * 逐字稿：丟掉時間碼與標記，一段字幕一行（段內的換行接成空白）。
 * 空白的段落會整段略過，不會留下空行。
 */
export function toPlainText(cues: readonly SubtitleCue[]): string {
  return cues
    .map((cue) => stripCueTags(cue.text).split("\n").map((line) => line.trim()).filter((line) => line !== "").join(" "))
    .filter((line) => line !== "")
    .join("\n");
}

/** 給 UI 標紅用的資料健檢：結束早於開始、或與前一段時間重疊。 */
export function findCueProblems(cues: readonly SubtitleCue[]): string[] {
  const problems: string[] = [];
  for (const [at, cue] of cues.entries()) {
    if (cue.endMs < cue.startMs) problems.push(`第 ${at + 1} 段的結束時間早於開始時間`);
    const previous = cues[at - 1];
    if (previous && cue.startMs < previous.endMs) problems.push(`第 ${at + 1} 段與前一段時間重疊`);
  }
  return problems;
}

/** 全部字幕的總長度（最後一段的結束時間）。 */
export function totalDurationMs(cues: readonly SubtitleCue[]): number {
  return cues.reduce((longest, cue) => Math.max(longest, cue.endMs), 0);
}
