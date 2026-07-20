"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { clampTrimRange, encodeWavPcm16, formatSeconds } from "@/lib/wav";

const MAX_SIZE = 30 * 1024 * 1024;
const MAX_PCM_BYTES = 250 * 1024 * 1024;
const MAX_MERGE_FILES = 8;
const MAX_MERGE_DECODED_BYTES = 110 * 1024 * 1024;
const MAX_MERGE_WORKING_BYTES = 210 * 1024 * 1024;
const ACCEPTED = /audio\/(mpeg|mp3|wav|x-wav|mp4|m4a|aac|ogg|webm)|^$/;

type Mode = "trim" | "merge";
type MergeItem = { id: string; file: File };

let mergeItemSequence = 0;

function fileError(file: File): string | null {
  if (!ACCEPTED.test(file.type)) return "支援 MP3、WAV、M4A、OGG 音訊檔";
  if (file.size > MAX_SIZE) return "單一檔案超過 30 MB 上限";
  return null;
}

export function AudioTrimmerTool() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mergeInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const playbackRef = useRef<{ context: AudioContext; source: AudioBufferSourceNode } | null>(null);
  const [mode, setMode] = useState<Mode>("trim");
  const [fileName, setFileName] = useState("");
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [mergeItems, setMergeItems] = useState<MergeItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => { stopPreview(); }, []);

  function stopPreview() {
    const playback = playbackRef.current;
    if (playback) {
      try { playback.source.stop(); } catch { /* 已停止 */ }
      void playback.context.close();
      playbackRef.current = null;
    }
    setPlaying(false);
  }

  function drawWaveform(buffer: AudioBuffer, selStart: number, selEnd: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = canvas.width;
    const height = canvas.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, width, height);
    const data = buffer.getChannelData(0);
    const samplesPerPixel = Math.max(1, Math.floor(data.length / width));
    const mid = height / 2;
    const startX = buffer.duration > 0 ? Math.floor((selStart / buffer.duration) * width) : 0;
    const endX = buffer.duration > 0 ? Math.ceil((selEnd / buffer.duration) * width) : width;
    context.fillStyle = "#dfe5f2";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#c3d3e8";
    context.fillRect(startX, 0, Math.max(1, endX - startX), height);
    for (let x = 0; x < width; x += 1) {
      let min = 1;
      let max = -1;
      const from = x * samplesPerPixel;
      for (let s = from; s < from + samplesPerPixel && s < data.length; s += 1) {
        const value = data[s];
        if (value < min) min = value;
        if (value > max) max = value;
      }
      const inSelection = x >= startX && x <= endX;
      context.fillStyle = inSelection ? "#3557ff" : "#8b96ad";
      const top = mid + min * mid * 0.92;
      const bottom = mid + max * mid * 0.92;
      context.fillRect(x, Math.min(top, bottom), 1, Math.max(1, Math.abs(bottom - top)));
    }
    context.fillStyle = "#ff6d4a";
    context.fillRect(startX, 0, 2, height);
    context.fillRect(Math.max(0, endX - 2), 0, 2, height);
  }

  /** 用 <audio> metadata 讀時長，回傳保守 PCM 預估（48kHz・立體聲・float32）。 */
  function estimatePcmBytes(file: File): Promise<number | null> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const probe = document.createElement("audio");
      let finished = false;
      const finish = (value: number | null) => {
        if (finished) return;
        finished = true;
        URL.revokeObjectURL(url);
        resolve(value);
      };
      probe.preload = "metadata";
      probe.onloadedmetadata = () => finish(Number.isFinite(probe.duration) ? probe.duration * 48_000 * 2 * 4 : null);
      probe.onerror = () => finish(null);
      window.setTimeout(() => finish(null), 4000);
      probe.src = url;
    });
  }

  async function decodeFile(file: File): Promise<AudioBuffer> {
    const invalidReason = fileError(file);
    if (invalidReason) throw new Error(invalidReason);
    const estimatedBytes = await estimatePcmBytes(file);
    if (estimatedBytes !== null && estimatedBytes > MAX_PCM_BYTES) {
      throw new Error(`這段音訊約 ${formatSeconds(estimatedBytes / (48_000 * 2 * 4))} 長，解碼後預估超過 ${MAX_PCM_BYTES / 1024 / 1024} MB 記憶體上限，請先用較短的檔案。`);
    }
    const arrayBuffer = await file.arrayBuffer();
    const context = new AudioContext();
    try {
      const buffer = await context.decodeAudioData(arrayBuffer);
      const pcmBytes = buffer.length * buffer.numberOfChannels * 4;
      if (pcmBytes > MAX_PCM_BYTES) {
        throw new Error(`這段音訊解碼後約需 ${(pcmBytes / 1024 / 1024).toFixed(0)} MB 記憶體，超過 ${MAX_PCM_BYTES / 1024 / 1024} MB 安全上限。請先剪短或使用較小的檔案。`);
      }
      return buffer;
    } finally {
      void context.close();
    }
  }

  async function loadFile(file: File | undefined) {
    setError("");
    stopPreview();
    if (!file) return;
    setBusy(true);
    try {
      const buffer = await decodeFile(file);
      bufferRef.current = buffer;
      setFileName(file.name);
      setDuration(buffer.duration);
      const initialEnd = Number(buffer.duration.toFixed(1));
      setStart(0);
      setEnd(initialEnd);
      requestAnimationFrame(() => drawWaveform(buffer, 0, initialEnd));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "無法解碼這個音訊檔 — 檔案可能損壞或格式不支援");
    } finally {
      setBusy(false);
    }
  }

  function applyRange(nextStart: number, nextEnd: number) {
    const clamped = clampTrimRange(nextStart, nextEnd, duration);
    setStart(clamped.start);
    setEnd(clamped.end);
    if (bufferRef.current) drawWaveform(bufferRef.current, clamped.start, clamped.end);
  }

  function previewSelection() {
    const buffer = bufferRef.current;
    if (!buffer) return;
    if (playing) { stopPreview(); return; }
    const context = new AudioContext();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => { stopPreview(); };
    source.start(0, start, Math.max(0.1, end - start));
    playbackRef.current = { context, source };
    setPlaying(true);
  }

  function downloadWav(wav: ArrayBuffer, name: string) {
    const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportWav() {
    const buffer = bufferRef.current;
    if (!buffer) return;
    const sampleRate = buffer.sampleRate;
    const from = Math.floor(start * sampleRate);
    const to = Math.min(buffer.length, Math.ceil(end * sampleRate));
    const channels: Float32Array[] = [];
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      channels.push(buffer.getChannelData(channel).slice(from, to));
    }
    downloadWav(encodeWavPcm16(channels, sampleRate), `${fileName.replace(/\.[^.]+$/, "") || "audio"}-剪輯.wav`);
  }

  function addMergeFiles(files: FileList | File[]) {
    if (busy) return;
    const incoming = Array.from(files);
    const invalid = incoming.find(fileError);
    if (invalid) {
      setError(`${invalid.name}：${fileError(invalid)}`);
      return;
    }
    const remaining = MAX_MERGE_FILES - mergeItems.length;
    const accepted = incoming.slice(0, Math.max(0, remaining));
    if (accepted.length === 0) {
      setError(`最多可合併 ${MAX_MERGE_FILES} 個音訊檔。`);
      return;
    }
    setMergeItems((items) => [...items, ...accepted.map((file) => ({ id: `${file.name}-${file.lastModified}-${mergeItemSequence += 1}`, file }))]);
    setError(incoming.length > accepted.length ? `已加入前 ${accepted.length} 個檔案，最多可合併 ${MAX_MERGE_FILES} 個。` : "");
  }

  function moveMergeItem(index: number, direction: -1 | 1) {
    setMergeItems((items) => {
      const target = index + direction;
      if (target < 0 || target >= items.length) return items;
      const next = [...items];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function resampleForMerge(buffer: AudioBuffer, sampleRate: number, channelCount: number): Promise<AudioBuffer> {
    if (buffer.sampleRate === sampleRate && buffer.numberOfChannels === channelCount) return buffer;
    const frameCount = Math.ceil(buffer.duration * sampleRate);
    const context = new OfflineAudioContext(channelCount, frameCount, sampleRate);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();
    return context.startRendering();
  }

  async function exportMergedWav() {
    if (mergeItems.length < 2) return;
    setBusy(true);
    setError("");
    try {
      const buffers: AudioBuffer[] = [];
      let decodedBytes = 0;
      for (const { file } of mergeItems) {
        const buffer = await decodeFile(file);
        decodedBytes += buffer.length * buffer.numberOfChannels * 4;
        if (decodedBytes > MAX_MERGE_DECODED_BYTES) {
          throw new Error(`合併前解碼的音訊超過 ${MAX_MERGE_DECODED_BYTES / 1024 / 1024} MB 安全上限，請減少檔案或先剪短。`);
        }
        buffers.push(buffer);
      }
      const sampleRate = buffers[0].sampleRate;
      const channelCount = Math.max(...buffers.map((buffer) => buffer.numberOfChannels));
      const frameCount = buffers.reduce((total, buffer) => total + (buffer.sampleRate === sampleRate ? buffer.length : Math.ceil(buffer.duration * sampleRate)), 0);
      const largestResampleBytes = Math.max(...buffers.map((buffer) => (
        buffer.sampleRate === sampleRate && buffer.numberOfChannels === channelCount
          ? 0
          : Math.ceil(buffer.duration * sampleRate) * channelCount * 4
      )));
      // 除了已解碼的來源與最終 WAV，也把同時存在的重取樣暫存 Buffer 算進去，
      // 避免不同取樣率的多檔案合併超出行動裝置可承受的記憶體。
      const workingBytes = decodedBytes + largestResampleBytes + frameCount * channelCount * 6 + 44;
      if (workingBytes > MAX_MERGE_WORKING_BYTES) {
        throw new Error(`合併輸出預估需要 ${(workingBytes / 1024 / 1024).toFixed(0)} MB 記憶體，超過 ${MAX_MERGE_WORKING_BYTES / 1024 / 1024} MB 安全上限。請減少檔案或先剪短。`);
      }
      const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
      let offset = 0;
      for (const buffer of buffers) {
        const normalized = await resampleForMerge(buffer, sampleRate, channelCount);
        for (let channel = 0; channel < channelCount; channel += 1) {
          channels[channel].set(normalized.getChannelData(channel), offset);
        }
        offset += normalized.length;
      }
      downloadWav(encodeWavPcm16(channels.map((channel) => channel.subarray(0, offset)), sampleRate), "合併音檔.wav");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "無法合併這些音訊檔，請確認檔案格式後再試一次。");
    } finally {
      setBusy(false);
    }
  }

  const hasAudio = duration > 0;
  return <section className="workspace audio-workspace page-shell" aria-label="音訊剪輯與合併工具">
    <div className="panel">
      <span className="privacy-badge background-remover-badge">♪ 音訊不上傳</span>
      <div className="audio-mode-tabs" role="group" aria-label="音訊功能">
        <button className="button button-small" type="button" aria-pressed={mode === "trim"} disabled={busy} onClick={() => { setMode("trim"); setError(""); }}>剪輯音檔</button>
        <button className="button button-small" type="button" aria-pressed={mode === "merge"} disabled={busy} onClick={() => { stopPreview(); setMode("merge"); setError(""); }}>合併音檔</button>
      </div>

      {mode === "trim" && <>
        {!hasAudio && (
          <div className="crop-dropzone" onDragOver={(event: DragEvent) => event.preventDefault()} onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); if (!busy) void loadFile(event.dataTransfer.files?.[0]); }}>
            <p><strong>把音訊檔拖到這裡</strong></p>
            <p className="key-note">或</p>
            <button className="button button-small button-blue" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? "解碼中…" : "選擇音訊檔"}</button>
            <p className="key-note">支援 MP3、WAV、M4A、OGG · 上限 30 MB</p>
          </div>
        )}
        <input ref={inputRef} className="file-input" type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg" onChange={(event: ChangeEvent<HTMLInputElement>) => { void loadFile(event.target.files?.[0]); event.currentTarget.value = ""; }} aria-label="選擇剪輯音訊檔" />
        {hasAudio && <>
          <p className="audio-file-line"><strong>{fileName}</strong><span className="panel-meta">總長 {formatSeconds(duration)}</span></p>
          <div className="audio-range-fields">
            <label className="field-label" htmlFor="audio-start">開始（秒）
              <input id="audio-start" className="number-input audio-number" type="number" min={0} max={Math.max(0, duration - 0.1)} step={0.1} value={start} onChange={(event) => applyRange(Number(event.target.value), end)} />
            </label>
            <label className="field-label" htmlFor="audio-end">結束（秒）
              <input id="audio-end" className="number-input audio-number" type="number" min={0.1} max={duration} step={0.1} value={end} onChange={(event) => applyRange(start, Number(event.target.value))} />
            </label>
            <span className="audio-selection-length">選取 {formatSeconds(end - start)}</span>
          </div>
          <label className="field-label" htmlFor="audio-start-slider">開始位置
            <input id="audio-start-slider" type="range" min={0} max={duration} step={0.1} value={start} onChange={(event) => applyRange(Number(event.target.value), end)} />
          </label>
          <label className="field-label" htmlFor="audio-end-slider">結束位置
            <input id="audio-end-slider" type="range" min={0} max={duration} step={0.1} value={end} onChange={(event) => applyRange(start, Number(event.target.value))} />
          </label>
          <div className="result-actions">
            <button className="button button-small button-secondary" type="button" onClick={previewSelection}>{playing ? "■ 停止" : "▶ 試聽選取段"}</button>
            <button className="button button-small button-blue" type="button" onClick={exportWav}>下載 WAV</button>
            <button className="button button-small button-secondary" type="button" onClick={() => { stopPreview(); bufferRef.current = null; setDuration(0); setFileName(""); }}>換一個檔案</button>
          </div>
          <p className="key-note">輸出為 PCM WAV，不進行第二次有損壓縮；MP3、AAC 等來源本身仍可能是有損格式。解碼與剪輯全程在瀏覽器本機完成。</p>
        </>}
      </>}

      {mode === "merge" && <>
        <div className="crop-dropzone" onDragOver={(event: DragEvent) => event.preventDefault()} onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); addMergeFiles(event.dataTransfer.files); }}>
          <p><strong>把要合併的音訊檔拖到這裡</strong></p>
          <p className="key-note">或</p>
          <button className="button button-small button-blue" type="button" onClick={() => mergeInputRef.current?.click()} disabled={busy}>{busy ? "合併中…" : "選擇多個音訊檔"}</button>
          <p className="key-note">依清單順序串接 · 最多 {MAX_MERGE_FILES} 個 · 單一檔案上限 30 MB</p>
        </div>
        <input ref={mergeInputRef} className="file-input" type="file" multiple accept="audio/*,.mp3,.wav,.m4a,.ogg" onChange={(event: ChangeEvent<HTMLInputElement>) => { if (event.target.files) addMergeFiles(event.target.files); event.currentTarget.value = ""; }} aria-label="選擇要合併的音訊檔" />
        {mergeItems.length > 0 && <>
          <ol className="audio-merge-list" aria-label="音訊合併順序">
            {mergeItems.map((item, index) => <li key={item.id}>
              <span className="pdf-merge-order" aria-hidden="true">{index + 1}</span>
              <span className="audio-merge-name">{item.file.name}<small>{(item.file.size / 1024 / 1024).toFixed(1)} MB</small></span>
              <span className="audio-merge-actions">
                <button className="icon-button" type="button" aria-label={`將 ${item.file.name} 上移`} disabled={busy || index === 0} onClick={() => moveMergeItem(index, -1)}>↑</button>
                <button className="icon-button" type="button" aria-label={`將 ${item.file.name} 下移`} disabled={busy || index === mergeItems.length - 1} onClick={() => moveMergeItem(index, 1)}>↓</button>
                <button className="icon-button" type="button" aria-label={`移除 ${item.file.name}`} disabled={busy} onClick={() => setMergeItems((items) => items.filter((candidate) => candidate.id !== item.id))}>×</button>
              </span>
            </li>)}
          </ol>
          <div className="result-actions">
            <button className="button button-small button-blue" type="button" disabled={busy || mergeItems.length < 2} onClick={() => { void exportMergedWav(); }}>{busy ? "正在合併…" : `合併 ${mergeItems.length} 個音檔並下載 WAV`}</button>
            <button className="button button-small button-secondary" type="button" disabled={busy} onClick={() => setMergeItems([])}>清空清單</button>
          </div>
          <p className="key-note">不同取樣率或聲道會自動統一為 WAV。合併在瀏覽器本機完成；為保護裝置記憶體，長音訊或多檔案可能會被拒絕。</p>
        </>}
      </>}
      {error && <p className="error-message" role="alert">{error}</p>}
    </div>
    <div className="panel panel-tinted">
      <div className="panel-header"><h2>{mode === "trim" ? "波形" : "合併說明"}</h2><span className="panel-meta">{mode === "trim" && hasAudio ? "藍色為選取範圍" : mode === "trim" ? "載入後顯示" : `${mergeItems.length} 個檔案`}</span></div>
      {mode === "trim" && (hasAudio
        ? <canvas ref={canvasRef} className="audio-waveform" width={720} height={180} aria-label="音訊波形，藍色區域為將保留的選取範圍" role="img" />
        : <div className="result-stage"><div className="result-empty"><strong>載入音訊後顯示波形</strong>用開始／結束時間（0.1 秒精度）框出要保留的片段，可先試聽再下載。</div></div>)}
      {mode === "merge" && <div className="result-stage"><div className="result-empty"><strong>照清單順序串接音檔</strong>可用上下按鈕調整順序。輸出會統一成 PCM WAV；{mergeItems.length < 2 ? "請至少加入兩個音檔。" : `目前將合併 ${mergeItems.length} 個檔案。`}</div></div>}
    </div>
  </section>;
}
