"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { SendToTools } from "@/components/send-to-tools";
import { SaveToWorkspace } from "@/components/save-to-workspace";
import { HandoffStatusBanner } from "@/components/handoff-status";
import { useTextHandoff } from "@/components/use-handoff";
import { TEXT_TOOL_SLUGS } from "@/lib/handoff";
import {
  filterCuesByRange,
  findCueProblems,
  formatTimecode,
  frameRateFactor,
  mergeAdjacentCues,
  parseSubtitle,
  parseTimecode,
  renumberCues,
  scaleCues,
  serializeCues,
  shiftCues,
  toPlainText,
  totalDurationMs,
  type SubtitleCue,
  type SubtitleFormat,
} from "@/lib/subtitle";

/** 與 manifest 的 `maxSizeBytes` 對齊；字幕是純文字，5 MB 已經是幾萬段的量。 */
const MAX_SIZE = 5 * 1024 * 1024;
/** 一次畫太多段會拖慢輸入；輸出與調整永遠針對全部字幕。 */
const MAX_VISIBLE_CUES = 300;

const FRAME_RATES = ["23.976", "24", "25", "29.97", "30", "50", "59.94", "60"] as const;

const FORMAT_META: Record<SubtitleFormat, { label: string; extension: string; mimeType: string }> = {
  srt: { label: "SRT（SubRip，逗號毫秒）", extension: ".srt", mimeType: "application/x-subrip;charset=utf-8" },
  vtt: { label: "VTT（WebVTT，句點毫秒）", extension: ".vtt", mimeType: "text/vtt;charset=utf-8" },
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 解析器丟的是帶行號的 Error；直接把訊息給使用者，不要換成含糊的通用字串。 */
function problemText(caught: unknown): string {
  return caught instanceof Error && caught.message !== "" ? caught.message : "無法解析字幕內容，請確認格式是 SRT 或 VTT";
}

export function SubtitleEditorTool() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [source, setSource] = useState("");
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  /** 載入時的原始字幕，用來一鍵還原所有調整。 */
  const [loadedCues, setLoadedCues] = useState<SubtitleCue[]>([]);
  const [outputFormat, setOutputFormat] = useState<SubtitleFormat>("srt");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const [offsetSeconds, setOffsetSeconds] = useState("0");
  const [sourceFps, setSourceFps] = useState("23.976");
  const [targetFps, setTargetFps] = useState("25");
  const [mergeGapMs, setMergeGapMs] = useState("200");
  const [rangeStart, setRangeStart] = useState("00:00:00,000");
  const [rangeEnd, setRangeEnd] = useState("00:10:00,000");

  function loadText(text: string, origin: string) {
    setError("");
    setNotice("");
    if (text.trim() === "") {
      setCues([]);
      setLoadedCues([]);
      return;
    }
    try {
      const parsed = parseSubtitle(text);
      if (parsed.cues.length === 0) {
        setError("這份內容裡找不到任何字幕段落");
        return;
      }
      setCues(parsed.cues);
      setLoadedCues(parsed.cues);
      setOutputFormat(parsed.format);
      setNotice(`${origin}：讀到 ${parsed.cues.length} 段字幕，判斷為 ${parsed.format.toUpperCase()} 格式`);
    } catch (caught) {
      setCues([]);
      setLoadedCues([]);
      setError(problemText(caught));
    }
  }

  const handoffStatus = useTextHandoff("subtitle-editor", (incoming) => {
    setSource(incoming);
    loadText(incoming, "從其他工具接力");
  });

  function onPickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_SIZE) {
      setError("字幕檔超過 5 MB 上限");
      return;
    }
    void file.text()
      .then((text) => {
        setSource("");
        loadText(text, `已讀取「${file.name}」`);
      })
      .catch(() => setError("無法讀取這個檔案，請確認它是 UTF-8 編碼的字幕檔"));
  }

  /** 調整類操作共用的外殼：成功就換掉字幕，失敗就把純函式的訊息原樣顯示。 */
  function applyChange(label: string, change: (current: readonly SubtitleCue[]) => SubtitleCue[]) {
    setError("");
    try {
      const next = change(cues);
      if (next.length === 0) {
        setError(`${label}之後就沒有任何字幕了，已保留原本的內容`);
        return;
      }
      setCues(next);
      setNotice(`${label}完成，目前 ${next.length} 段字幕`);
    } catch (caught) {
      setNotice("");
      setError(problemText(caught));
    }
  }

  function updateCueText(index: number, text: string) {
    setCues((previous) => previous.map((cue, at) => (at === index ? { ...cue, text } : cue)));
  }

  function deleteCue(index: number) {
    setCues((previous) => renumberCues(previous.filter((_, at) => at !== index)));
    setNotice("");
  }

  function reset() {
    setCues([]);
    setLoadedCues([]);
    setSource("");
    setNotice("");
    setError("");
  }

  const outputText = useMemo(() => serializeCues(cues, outputFormat), [cues, outputFormat]);
  const transcript = useMemo(() => toPlainText(cues), [cues]);
  const outputBlob = useMemo(
    () => (outputText === "" ? null : new Blob([outputText], { type: FORMAT_META[outputFormat].mimeType })),
    [outputText, outputFormat],
  );
  const problems = useMemo(() => findCueProblems(cues), [cues]);
  const duration = useMemo(() => (cues.length === 0 ? "" : formatTimecode(totalDurationMs(cues), outputFormat)), [cues, outputFormat]);
  const visibleCues = cues.slice(0, MAX_VISIBLE_CUES);

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(outputText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      setError("無法複製到剪貼簿，請改用下載");
    }
  }

  return <section className="workspace subtitle-workspace page-shell" aria-label="字幕編輯器">
    <div className="panel subtitle-panel">
      <div className="panel-header">
        <h2>字幕來源</h2>
        <span className="panel-meta">{cues.length > 0 ? `${cues.length} 段 · 總長 ${duration}` : "SRT／VTT，本機處理不上傳"}</span>
      </div>

      {cues.length === 0 && (
        <>
          <label className="sr-only" htmlFor="subtitle-input">貼上字幕內容</label>
          <textarea
            id="subtitle-input"
            className="participant-input subtitle-input"
            value={source}
            onChange={(event) => { setSource(event.target.value); loadText(event.target.value, "已讀取貼上的內容"); }}
            placeholder={"貼上 SRT 或 VTT 字幕內容（格式自動判斷）…\n\n1\n00:00:01,000 --> 00:00:03,500\n第一句字幕"}
            spellCheck={false}
          />
          <div className="subtitle-import-toolbar">
            <button className="button button-small button-blue" type="button" onClick={() => fileRef.current?.click()}>開啟字幕檔</button>
            <span className="key-note">支援 .srt 與 .vtt，單檔上限 5 MB，需為 UTF-8 編碼。</span>
          </div>
          <input ref={fileRef} className="file-input" type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" onChange={onPickFile} aria-label="選擇字幕檔" />
        </>
      )}

      {cues.length > 0 && (
        <div className="subtitle-controls">
          <div className="subtitle-control-group">
            <h3>整體偏移</h3>
            <p className="key-note">音畫整片差固定秒數時用這個。正數往後、負數往前，可填小數；被推到 0 之前的時間會夾在開頭。</p>
            <div className="subtitle-control-row">
              <label className="field-label" htmlFor="subtitle-offset">偏移秒數
                <input id="subtitle-offset" className="key-input" type="number" step="0.1" value={offsetSeconds} onChange={(event) => setOffsetSeconds(event.target.value)} />
              </label>
              <button className="button button-small button-blue" type="button" onClick={() => applyChange("整體偏移", (current) => shiftCues(current, Number(offsetSeconds)))}>套用偏移</button>
            </div>
          </div>

          <div className="subtitle-control-group">
            <h3>倍率校正（影格率）</h3>
            <p className="key-note">開頭準、越後面差越多時用這個。倍率＝來源影格率 ÷ 目標影格率，目前為 {frameRateFactor(Number(sourceFps), Number(targetFps)).toFixed(5)}。</p>
            <div className="subtitle-control-row">
              <label className="field-label" htmlFor="subtitle-source-fps">來源影格率
                <select id="subtitle-source-fps" className="key-input" value={sourceFps} onChange={(event) => setSourceFps(event.target.value)}>
                  {FRAME_RATES.map((fps) => <option key={fps} value={fps}>{fps} fps</option>)}
                </select>
              </label>
              <label className="field-label" htmlFor="subtitle-target-fps">目標影格率
                <select id="subtitle-target-fps" className="key-input" value={targetFps} onChange={(event) => setTargetFps(event.target.value)}>
                  {FRAME_RATES.map((fps) => <option key={fps} value={fps}>{fps} fps</option>)}
                </select>
              </label>
              <button className="button button-small button-blue" type="button" onClick={() => applyChange("倍率校正", (current) => scaleCues(current, frameRateFactor(Number(sourceFps), Number(targetFps))))}>套用倍率</button>
            </div>
          </div>

          <div className="subtitle-control-group">
            <h3>合併與篩選</h3>
            <div className="subtitle-control-row">
              <label className="field-label" htmlFor="subtitle-gap">合併間隔（毫秒）
                <input id="subtitle-gap" className="key-input" type="number" min="0" step="50" value={mergeGapMs} onChange={(event) => setMergeGapMs(event.target.value)} />
              </label>
              <button className="button button-small button-secondary" type="button" onClick={() => applyChange("合併相鄰字幕", (current) => mergeAdjacentCues(current, Number(mergeGapMs)))}>合併相鄰字幕</button>
            </div>
            <div className="subtitle-control-row">
              <label className="field-label" htmlFor="subtitle-range-start">保留範圍起
                <input id="subtitle-range-start" className="key-input" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} placeholder="00:00:00,000" />
              </label>
              <label className="field-label" htmlFor="subtitle-range-end">保留範圍迄
                <input id="subtitle-range-end" className="key-input" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} placeholder="00:10:00,000" />
              </label>
              <button className="button button-small button-secondary" type="button" onClick={() => applyChange("依時間範圍篩選", (current) => filterCuesByRange(current, parseTimecode(rangeStart), parseTimecode(rangeEnd)))}>只保留這段</button>
            </div>
          </div>

          <div className="subtitle-control-row">
            <button className="button button-small button-secondary" type="button" onClick={() => { setCues(loadedCues); setNotice("已還原成載入時的字幕"); setError(""); }} disabled={cues === loadedCues}>還原所有調整</button>
            <button className="button button-small button-secondary" type="button" onClick={reset}>換一份字幕</button>
          </div>
        </div>
      )}

      {notice && <p className="gantt-notice-info" role="status">{notice}</p>}
      {error && <p className="error-message" role="alert">{error}</p>}
      <HandoffStatusBanner status={handoffStatus} />
    </div>

    {cues.length > 0 && (
      <div className="panel panel-tinted subtitle-panel">
        <div className="panel-header">
          <h2>字幕內容</h2>
          <span className="panel-meta">序號會在輸出時自動重排</span>
        </div>

        <div className="subtitle-control-row">
          <label className="field-label" htmlFor="subtitle-format">輸出格式
            <select id="subtitle-format" className="key-input" value={outputFormat} onChange={(event) => setOutputFormat(event.target.value as SubtitleFormat)}>
              {(Object.keys(FORMAT_META) as SubtitleFormat[]).map((format) => (
                <option key={format} value={format}>{FORMAT_META[format].label}</option>
              ))}
            </select>
          </label>
        </div>

        {problems.length > 0 && (
          <p className="error-message" role="status">
            時間有 {problems.length} 處需要確認：{problems.slice(0, 3).join("、")}
            {problems.length > 3 ? " …" : ""}
          </p>
        )}

        <ol className="subtitle-list">
          {visibleCues.map((cue, index) => (
            <li key={index} className="subtitle-cue">
              <div className="subtitle-cue-head">
                <span className="subtitle-cue-index">#{index + 1}</span>
                <span className="subtitle-cue-time">
                  {formatTimecode(cue.startMs, outputFormat)} → {formatTimecode(cue.endMs, outputFormat)}
                </span>
                <button className="gantt-row-delete" type="button" title="刪除這段字幕" aria-label={`刪除第 ${index + 1} 段字幕`} onClick={() => deleteCue(index)}>✕</button>
              </div>
              <label className="sr-only" htmlFor={`subtitle-cue-${index}`}>第 {index + 1} 段字幕文字</label>
              <textarea
                id={`subtitle-cue-${index}`}
                className="subtitle-cue-text"
                value={cue.text}
                rows={Math.min(4, cue.text.split("\n").length + 1)}
                onChange={(event) => updateCueText(index, event.target.value)}
              />
            </li>
          ))}
        </ol>
        {cues.length > MAX_VISIBLE_CUES && (
          <p className="key-note">為維持流暢僅顯示前 {MAX_VISIBLE_CUES} 段，調整與輸出仍包含全部 {cues.length} 段。</p>
        )}

        <div className="result-actions">
          <button className="button button-small button-blue" type="button" onClick={copyOutput}>{copied ? "已複製 ✓" : `複製 ${outputFormat.toUpperCase()}`}</button>
          <button className="button button-small button-secondary" type="button" onClick={() => downloadBlob(new Blob([serializeCues(cues, "srt")], { type: FORMAT_META.srt.mimeType }), "toolverse-字幕.srt")}>下載 .srt</button>
          <button className="button button-small button-secondary" type="button" onClick={() => downloadBlob(new Blob([serializeCues(cues, "vtt")], { type: FORMAT_META.vtt.mimeType }), "toolverse-字幕.vtt")}>下載 .vtt</button>
          <button className="button button-small button-secondary" type="button" onClick={() => downloadBlob(new Blob([transcript], { type: "text/plain;charset=utf-8" }), "toolverse-逐字稿.txt")} disabled={transcript === ""}>下載逐字稿 .txt</button>
        </div>

        <SaveToWorkspace blob={outputBlob} name={`toolverse-字幕${FORMAT_META[outputFormat].extension}`} sourceTool="subtitle-editor" handoffKind="text" />
        <SendToTools from="subtitle-editor" targets={TEXT_TOOL_SLUGS} getText={() => outputText} />
      </div>
    )}
  </section>;
}
