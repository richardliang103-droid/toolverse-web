"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { clampTrimRange, encodeWavPcm16, formatSeconds } from "@/lib/wav";

const MAX_SIZE = 30 * 1024 * 1024;
const ACCEPTED = /audio\/(mpeg|mp3|wav|x-wav|mp4|m4a|aac|ogg|webm)|^$/;

export function AudioTrimmerTool() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const playbackRef = useRef<{ context: AudioContext; source: AudioBufferSourceNode } | null>(null);
  const [fileName, setFileName] = useState("");
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
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

  async function loadFile(file: File | undefined) {
    setError("");
    stopPreview();
    if (!file) return;
    if (!ACCEPTED.test(file.type)) { setError("支援 MP3、WAV、M4A、OGG 音訊檔"); return; }
    if (file.size > MAX_SIZE) { setError("檔案超過 30 MB 上限"); return; }
    setBusy(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const context = new AudioContext();
      const buffer = await context.decodeAudioData(arrayBuffer);
      void context.close();
      bufferRef.current = buffer;
      setFileName(file.name);
      setDuration(buffer.duration);
      const initialEnd = Number(buffer.duration.toFixed(1));
      setStart(0);
      setEnd(initialEnd);
      requestAnimationFrame(() => drawWaveform(buffer, 0, initialEnd));
    } catch {
      setError("無法解碼這個音訊檔 — 檔案可能損壞或格式不支援");
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
    const wav = encodeWavPcm16(channels, sampleRate);
    const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${fileName.replace(/\.[^.]+$/, "") || "audio"}-剪輯.wav`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const hasAudio = duration > 0;

  return <section className="workspace audio-workspace page-shell" aria-label="音訊剪輯工具">
    <div className="panel">
      <span className="privacy-badge background-remover-badge">♪ 音訊不上傳</span>
      {!hasAudio && (
        <div className="crop-dropzone" onDragOver={(event: DragEvent) => event.preventDefault()} onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); void loadFile(event.dataTransfer.files?.[0]); }}>
          <p><strong>把音訊檔拖到這裡</strong></p>
          <p className="key-note">或</p>
          <button className="button button-small button-blue" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? "解碼中…" : "選擇音訊檔"}</button>
          <p className="key-note">支援 MP3、WAV、M4A、OGG · 上限 30 MB</p>
        </div>
      )}
      <input ref={inputRef} className="file-input" type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg" onChange={(event: ChangeEvent<HTMLInputElement>) => { void loadFile(event.target.files?.[0]); }} aria-label="選擇音訊檔" />
      {hasAudio && (
        <>
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
          <p className="key-note">輸出為無損 WAV（不重新壓縮）；需要 MP3 可再用其他工具轉檔。解碼與剪輯全程在瀏覽器本機完成。</p>
        </>
      )}
      {error && <p className="error-message" role="alert">{error}</p>}
    </div>
    <div className="panel panel-tinted">
      <div className="panel-header"><h2>波形</h2><span className="panel-meta">{hasAudio ? "藍色為選取範圍" : "載入後顯示"}</span></div>
      {hasAudio
        ? <canvas ref={canvasRef} className="audio-waveform" width={720} height={180} aria-label="音訊波形，藍色區域為將保留的選取範圍" role="img" />
        : <div className="result-stage"><div className="result-empty"><strong>載入音訊後顯示波形</strong>用開始／結束時間（0.1 秒精度）框出要保留的片段，可先試聽再下載。</div></div>}
    </div>
  </section>;
}
