"use client";

/* eslint-disable @next/next/no-img-element -- previews use short-lived local blob URLs */

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SIZE = 10 * 1024 * 1024;

export function BackgroundRemover() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [compare, setCompare] = useState(50);

  useEffect(() => () => { if (originalUrl) URL.revokeObjectURL(originalUrl); if (resultUrl) URL.revokeObjectURL(resultUrl); }, [originalUrl, resultUrl]);

  function selectFile(candidate?: File) {
    if (!candidate) return;
    setError("");
    if (!ALLOWED_TYPES.has(candidate.type)) { setError("只支援 JPG、PNG 與 WebP 圖片"); return; }
    if (candidate.size > MAX_SIZE) { setError("圖片大小不能超過 10 MB"); return; }
    if (originalUrl) URL.revokeObjectURL(originalUrl); if (resultUrl) URL.revokeObjectURL(resultUrl);
    setFile(candidate); setOriginalUrl(URL.createObjectURL(candidate)); setResultUrl(""); setCompare(50);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) { selectFile(event.target.files?.[0]); }
  function onDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files?.[0]); }

  async function removeBackground() {
    if (!file) return;
    setProcessing(true); setError("");
    try {
      const body = new FormData(); body.append("image", file);
      const response = await fetch("/api/remove-background", { method: "POST", body });
      if (!response.ok) { const data = await response.json().catch(() => null) as { error?: string } | null; throw new Error(data?.error || "圖片去背失敗，請稍後再試"); }
      const blob = await response.blob(); setResultUrl(URL.createObjectURL(blob));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "圖片去背失敗"); }
    finally { setProcessing(false); }
  }

  function clear() { if (originalUrl) URL.revokeObjectURL(originalUrl); if (resultUrl) URL.revokeObjectURL(resultUrl); setFile(null); setOriginalUrl(""); setResultUrl(""); setError(""); if (inputRef.current) inputRef.current.value = ""; }

  return <section className="workspace upload-workspace page-shell" aria-label="圖片去背工具">
    <div className="panel"><div className={`drop-zone ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}><div><div className="drop-icon" aria-hidden="true">↥</div><h2>{file ? file.name : "把圖片拖到這裡"}</h2><p>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · 已準備好` : "或從裝置選擇一張圖片"}</p><span className="button button-secondary">{file ? "更換圖片" : "選擇圖片"}</span><input ref={inputRef} className="file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={onFileChange} aria-label="選擇要去背的圖片" /><small className="file-note">JPG、PNG、WebP · 最大 10 MB</small></div></div>{file && <div className="preview-actions"><button className="button button-coral" type="button" onClick={removeBackground} disabled={processing}>{processing ? "處理中…" : "開始去背"}</button><button className="button button-secondary" type="button" onClick={clear}>清除</button></div>}{error && <p className="error-message" role="alert">{error}</p>}<div className="service-notice">圖片會安全傳送至外部去背服務進行即時處理，本站不會永久儲存你的圖片。</div></div>
    <div className="panel panel-tinted preview-shell"><div className="panel-header"><h2>{resultUrl ? "去背結果" : "圖片預覽"}</h2><span className="panel-meta">{resultUrl ? "拖曳滑桿比較" : "透明 PNG"}</span></div>{processing ? <div className="preview-canvas processing-state"><div><div className="processing-disc" /><strong>正在辨識主體與背景</strong><p>通常只需要幾秒鐘</p></div></div> : originalUrl ? <><div className="preview-canvas">{resultUrl ? <><img src={resultUrl} alt="去背結果預覽" /><div className="compare-original" style={{ width: `${compare}%`, ["--compare-width" as string]: `${10000 / compare}%` }}><img src={originalUrl} alt="原始圖片預覽" /></div></> : <img src={originalUrl} alt="原始圖片預覽" />}</div>{resultUrl && <><label className="sr-only" htmlFor="compare-slider">原圖與去背結果比較</label><input id="compare-slider" className="compare-range" type="range" min="1" max="99" value={compare} onChange={(event) => setCompare(Number(event.target.value))} /><div className="preview-actions"><a className="button button-blue" href={resultUrl} download="hermes-background-removed.png">下載透明 PNG</a><button className="button button-secondary" type="button" onClick={removeBackground}>重新處理</button></div></>}</> : <div className="preview-canvas result-empty"><div><strong>預覽區</strong>選擇圖片後，原圖與去背結果會顯示在這裡。</div></div>}</div>
  </section>;
}
