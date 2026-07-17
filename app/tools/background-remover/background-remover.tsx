"use client";

/* eslint-disable @next/next/no-img-element -- previews use short-lived local blob URLs */

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SIZE = 10 * 1024 * 1024;

type WorkerResponse =
  | { type: "progress"; progress: number; stage: string }
  | { type: "ready"; backend: "WebGPU" | "WASM" }
  | { type: "result"; blob: Blob; backend: "WebGPU" | "WASM" }
  | { type: "error"; message: string; detail?: string };

type RemoveBgMode = "local" | "removebg";

export function BackgroundRemover() {
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const originalUrlRef = useRef("");
  const resultUrlRef = useRef("");
  const [file, setFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [errorDetail, setErrorDetail] = useState("");
  const [compare, setCompare] = useState(50);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("準備本機模型");
  const [backend, setBackend] = useState<"WebGPU" | "WASM" | "">("");
  const [modelReady, setModelReady] = useState(false);
  const [mode, setMode] = useState<RemoveBgMode>("local");
  const [removeBgKey, setRemoveBgKey] = useState("");

  useEffect(() => () => {
    workerRef.current?.terminate();
    if (originalUrlRef.current) URL.revokeObjectURL(originalUrlRef.current);
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
  }, []);

  function getWorker() {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL("./background-remover.worker.ts", import.meta.url), { type: "module" });
    }
    return workerRef.current;
  }

  function selectFile(candidate?: File) {
    if (!candidate) return;
    setError("");
    if (!ALLOWED_TYPES.has(candidate.type)) { setError("只支援 JPG、PNG 與 WebP 圖片"); return; }
    if (candidate.size > MAX_SIZE) { setError("圖片大小不能超過 10 MB"); return; }
    if (originalUrlRef.current) URL.revokeObjectURL(originalUrlRef.current);
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    originalUrlRef.current = URL.createObjectURL(candidate);
    resultUrlRef.current = "";
    setFile(candidate);
    setOriginalUrl(originalUrlRef.current);
    setResultUrl("");
    setCompare(50);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) { selectFile(event.target.files?.[0]); }
  function onDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files?.[0]); }

  function runLocally(image: File) {
    const worker = getWorker();
    return new Promise<Blob>((resolve, reject) => {
      const cleanup = () => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onWorkerError);
      };
      const onWorkerError = (event: ErrorEvent) => {
        cleanup();
        const failure = new Error("本機模型無法啟動，請重新整理後再試");
        if (event?.message) (failure as Error & { detail?: string }).detail = event.message;
        reject(failure);
      };
      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (message.type === "progress") { setProgress(message.progress); setStage(message.stage); return; }
        if (message.type === "ready") { setBackend(message.backend); setModelReady(true); setStage("正在辨識主體與背景"); return; }
        cleanup();
        if (message.type === "result") { setBackend(message.backend); resolve(message.blob); }
        if (message.type === "error") {
          const failure = new Error(message.message);
          if (message.detail) (failure as Error & { detail?: string }).detail = message.detail;
          reject(failure);
        }
      };
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onWorkerError);
      worker.postMessage({ type: "remove", file: image });
    });
  }

  function isDecodeFailure(caught: unknown) {
    const detail = caught instanceof Error ? `${(caught as Error & { detail?: string }).detail ?? ""} ${caught.message}` : String(caught);
    return /InvalidStateError|could not be decoded|unusable/i.test(detail);
  }

  /** Worker 內的 createImageBitmap 支援的格式較少（HEIC、CMYK JPEG 會失敗）；
      改用 <img> 在主執行緒解碼後轉成標準 PNG 再重試。 */
  async function reencodeAsPng(source: File) {
    const url = URL.createObjectURL(source);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context || canvas.width === 0 || canvas.height === 0) throw new Error("canvas unavailable");
      context.drawImage(image, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("png encoding failed");
      return new File([blob], `${source.name.replace(/\.[^.]+$/, "")}.png`, { type: "image/png" });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function runLocallyWithDecodeFallback(image: File) {
    try {
      return await runLocally(image);
    } catch (caught) {
      if (!isDecodeFailure(caught)) throw caught;
      setStage("圖片格式特殊，正在轉檔重試");
      let normalized: File;
      try {
        normalized = await reencodeAsPng(image);
      } catch {
        const failure = new Error("瀏覽器無法解碼這張圖片 — 檔案可能已損壞，或是改了副檔名的 HEIC 等特殊格式。請先轉存成一般的 JPG 或 PNG 再試。");
        (failure as Error & { detail?: string }).detail = caught instanceof Error ? (caught as Error & { detail?: string }).detail ?? caught.message : String(caught);
        throw failure;
      }
      return runLocally(normalized);
    }
  }

  async function runWithRemoveBg(image: File) {
    if (removeBgKey.trim().length < 10) throw new Error("請輸入有效的 remove.bg API 金鑰");
    const form = new FormData();
    form.set("image", image);
    form.set("apiKey", removeBgKey.trim());
    const response = await fetch("/api/remove-background", { method: "POST", body: form });
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(data?.error || `remove.bg 服務暫時無法使用（${response.status}）`);
    }
    return response.blob();
  }

  async function removeBackground() {
    if (!file) return;
    setProcessing(true); setError(""); setErrorDetail("");
    if (mode === "local") { setProgress(modelReady ? 100 : 0); setStage(modelReady ? "正在辨識主體與背景" : "正在下載本機模型"); }
    else { setStage("正在呼叫 remove.bg…"); }
    try {
      const blob = mode === "local" ? await runLocallyWithDecodeFallback(file) : await runWithRemoveBg(file);
      if (mode === "removebg") setBackend("");
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
      resultUrlRef.current = URL.createObjectURL(blob);
      setResultUrl(resultUrlRef.current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "圖片去背失敗");
      setErrorDetail(caught instanceof Error ? (caught as Error & { detail?: string }).detail ?? "" : "");
    } finally {
      setProcessing(false);
    }
  }

  function clear() {
    if (originalUrlRef.current) URL.revokeObjectURL(originalUrlRef.current);
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    originalUrlRef.current = "";
    resultUrlRef.current = "";
    setFile(null); setOriginalUrl(""); setResultUrl(""); setError(""); setErrorDetail(""); setProgress(0);
    if (inputRef.current) inputRef.current.value = "";
  }

  return <section className="workspace upload-workspace page-shell" aria-label="圖片去背工具">
    <div className="panel">
      <span className={`privacy-badge background-remover-badge ${mode === "removebg" ? "uploads" : ""}`}>{mode === "local" ? "◐ 圖片不上傳" : "● 圖片會上傳至 remove.bg"}</span>
      <div className={`drop-zone ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}>
        <div><div className="drop-icon" aria-hidden="true">↥</div><h2>{file ? file.name : "把圖片拖到這裡"}</h2><p>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · 已準備好` : "或從裝置選擇一張圖片"}</p><span className="button button-secondary">{file ? "更換圖片" : "選擇圖片"}</span><input ref={inputRef} className="file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={onFileChange} aria-label="選擇要去背的圖片" /><small className="file-note">JPG、PNG、WebP · 最大 10 MB</small></div>
      </div>
      <div className="flow-mode-toggle" role="radiogroup" aria-label="去背方式">
        <button type="button" className={`button button-small ${mode === "local" ? "button-coral" : "button-secondary"}`} aria-pressed={mode === "local"} onClick={() => setMode("local")} disabled={processing}>本機 AI（免費、圖片不上傳）</button>
        <button type="button" className={`button button-small ${mode === "removebg" ? "button-coral" : "button-secondary"}`} aria-pressed={mode === "removebg"} onClick={() => setMode("removebg")} disabled={processing}>remove.bg API</button>
      </div>
      {mode === "removebg" && <label className="field-label" htmlFor="removebg-key">remove.bg API 金鑰<input id="removebg-key" className="key-input" type="password" value={removeBgKey} onChange={(event) => setRemoveBgKey(event.target.value)} autoComplete="off" spellCheck={false} placeholder="貼上你的金鑰" /></label>}
      {file && <div className="preview-actions"><button className="button button-coral" type="button" onClick={removeBackground} disabled={processing}>{processing ? (mode === "local" ? "本機處理中…" : "呼叫 remove.bg 中…") : (mode === "local" ? "開始本機去背" : "用 remove.bg 去背")}</button><button className="button button-secondary" type="button" onClick={clear} disabled={processing}>清除</button></div>}
      {error && <p className="error-message" role="alert">{error}{errorDetail && <><br /><small>技術細節：{errorDetail}</small></>}</p>}
      {mode === "local"
        ? <div className="service-notice service-notice-private"><strong>100% 本機處理</strong><span>圖片不會上傳。首次使用會下載約數十 MB 的 AI 模型，之後由瀏覽器快取。</span></div>
        : <div className="service-notice"><strong>需要金鑰，圖片會經過 remove.bg</strong><span>金鑰只暫存在這個頁面。圖片會先經過 ToolVerse 伺服器轉送一次（remove.bg 不支援瀏覽器直接呼叫），再送到 remove.bg 處理，不會被儲存。到 <a href="https://www.remove.bg/api" target="_blank" rel="noopener noreferrer">remove.bg</a> 免費申請，每月 50 次免費額度，超過需付費；免費額度可能只回傳較低解析度的預覽圖。</span></div>}
    </div>
    <div className="panel panel-tinted preview-shell">
      <div className="panel-header"><h2>{resultUrl ? "去背結果" : "圖片預覽"}</h2><span className="panel-meta">{mode === "removebg" ? "remove.bg" : backend ? `${backend} 本機運算` : "WebGPU／WASM"}</span></div>
      {processing ? <div className="preview-canvas processing-state"><div className="processing-content"><div className="processing-disc" /><strong>{stage}</strong><p>{mode === "removebg" ? "圖片正在透過 ToolVerse 轉送給 remove.bg" : modelReady ? "所有運算都在這台裝置完成" : "首次載入時間取決於網路速度"}</p>{mode === "local" && <><div className="model-progress" role="progressbar" aria-label="模型下載進度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><span style={{ width: `${Math.max(4, progress)}%` }} /></div><small>{modelReady ? "AI 模型已就緒" : `${Math.round(progress)}%`}</small></>}</div></div> : originalUrl ? <><div className="preview-canvas">{resultUrl ? <><img src={resultUrl} alt="去背結果預覽" /><div className="compare-original" style={{ width: `${compare}%`, ["--compare-width" as string]: `${10000 / compare}%` }}><img src={originalUrl} alt="原始圖片預覽" /></div></> : <img src={originalUrl} alt="原始圖片預覽" />}</div>{resultUrl && <><label className="sr-only" htmlFor="compare-slider">原圖與去背結果比較</label><input id="compare-slider" className="compare-range" type="range" min="1" max="99" value={compare} onChange={(event) => setCompare(Number(event.target.value))} /><div className="preview-actions"><a className="button button-blue" href={resultUrl} download="toolverse-background-removed.png">下載透明 PNG</a><button className="button button-secondary" type="button" onClick={removeBackground}>重新處理</button></div></>}</> : <div className="preview-canvas"><div className="result-empty"><strong>預覽區</strong>選擇圖片後，原圖與去背結果會顯示在這裡。</div></div>}
    </div>
  </section>;
}
