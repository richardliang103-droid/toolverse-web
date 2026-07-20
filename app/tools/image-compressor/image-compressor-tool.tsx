"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import { CountUp } from "@/components/count-up";
import { createZip, downloadBlob } from "@/lib/download-zip";
import { QUALITY_FORMATS, fitDimensions, formatBytes, mimeForFormat, outputFilename, savingsPercent } from "@/lib/image-compress";
import { exceedsImagePixelLimit, imagePixelLimitMessage } from "@/lib/image-limits";
import type { OutputFormat } from "@/lib/image-compress";

const STORAGE_KEY = "toolverse:image-compressor:v1";
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILES = 20;
const MAX_SIZE = 25 * 1024 * 1024;

type ItemStatus = "queued" | "working" | "done" | "error";

type CompressItem = {
  id: string;
  file: File;
  status: ItemStatus;
  outputBlob?: Blob;
  outputName?: string;
  outputSize?: number;
  width?: number;
  height?: number;
  message?: string;
  keptOriginal?: boolean;
};

type StoredOptions = { format: OutputFormat; quality: number; maxEdge: number };

function sanitizeOptions(value: unknown): StoredOptions {
  const data = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const format = data.format === "jpeg" || data.format === "png" || data.format === "webp" ? data.format : "original";
  const quality = typeof data.quality === "number" && data.quality >= 30 && data.quality <= 100 ? Math.round(data.quality) : 80;
  const maxEdge = data.maxEdge === 1000 || data.maxEdge === 2000 || data.maxEdge === 4000 ? data.maxEdge : 0;
  return { format, quality, maxEdge };
}

async function compressFile(file: File, options: StoredOptions): Promise<{ blob: Blob; name: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    if (exceedsImagePixelLimit(bitmap.width, bitmap.height)) throw new Error("pixel limit");
    const { width, height } = fitDimensions(bitmap.width, bitmap.height, options.maxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("此瀏覽器不支援 canvas");
    const mime = mimeForFormat(options.format, file.type);
    if (mime === "image/jpeg") { context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height); }
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, mime, QUALITY_FORMATS.has(mime.replace("image/", "")) ? options.quality / 100 : undefined);
    });
    if (!blob) throw new Error("壓縮失敗，請換一張圖片");
    return { blob, name: outputFilename(file.name, mime), width, height };
  } finally {
    bitmap.close();
  }
}

export function ImageCompressorTool() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<CompressItem[]>([]);
  const [format, setFormat] = useState<OutputFormat>("original");
  const [quality, setQuality] = useState(80);
  const [maxEdge, setMaxEdge] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const options = sanitizeOptions(JSON.parse(saved));
        // 還原此裝置的偏好需要一次性的 client hydration。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFormat(options.format); setQuality(options.quality); setMaxEdge(options.maxEdge);
      }
    } catch { localStorage.removeItem(STORAGE_KEY); }
     
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ format, quality, maxEdge }));
  }, [hydrated, format, quality, maxEdge]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setError("");
    const incoming: CompressItem[] = [];
    for (const file of Array.from(list)) {
      const acceptable = ACCEPTED.has(file.type) || (file.type === "" && /\.(jpe?g|png|webp)$/i.test(file.name));
      if (!acceptable) { setError("只支援 JPG、PNG 與 WebP 圖片"); continue; }
      if (file.size > MAX_SIZE) { setError(`「${file.name}」超過 25 MB 上限`); continue; }
      incoming.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file, status: "queued" });
    }
    setItems((previous) => [...previous, ...incoming].slice(0, MAX_FILES));
  }

  async function compressAll() {
    setBusy(true); setError("");
    const options: StoredOptions = { format, quality, maxEdge };
    const pending = items.filter((item) => item.status !== "done");
    for (const item of pending) {
      setItems((previous) => previous.map((entry) => (entry.id === item.id ? { ...entry, status: "working" } : entry)));
      try {
        const result = await compressFile(item.file, options);
        const keptOriginal = options.format === "original" && options.maxEdge === 0 && result.blob.size >= item.file.size;
        const outputBlob = keptOriginal ? item.file : result.blob;
        const outputName = keptOriginal ? item.file.name : result.name;
        setItems((previous) => previous.map((entry) => (entry.id === item.id
          ? { ...entry, status: "done", outputBlob, outputName, outputSize: outputBlob.size, width: result.width, height: result.height, keptOriginal }
          : entry)));
      } catch (caught) {
        const message = caught instanceof Error && caught.message === "pixel limit"
          ? imagePixelLimitMessage()
          : caught instanceof Error && /decoded|InvalidState/i.test(`${caught.name} ${caught.message}`)
          ? "無法解碼，檔案可能損壞或是特殊格式"
          : "壓縮失敗，請重試或換一張圖片";
        setItems((previous) => previous.map((entry) => (entry.id === item.id ? { ...entry, status: "error", message } : entry)));
      }
    }
    setBusy(false);
  }

  /** 設定變更後，已完成／失敗的項目標回待處理，「開始壓縮」會用新設定重跑。 */
  function requeueFinished() {
    setItems((previous) => previous.map((item) => (item.status === "done" || item.status === "error"
      ? { id: item.id, file: item.file, status: "queued" as const }
      : item)));
  }

  async function downloadAll() {
    const completed = items.filter((item): item is CompressItem & { outputBlob: Blob; outputName: string } => item.status === "done" && Boolean(item.outputBlob && item.outputName));
    if (completed.length < 2) return;
    downloadBlob(await createZip(completed.map((item) => ({ name: item.outputName, blob: item.outputBlob }))), "toolverse-compressed-images.zip");
  }

  function removeItem(id: string) {
    setItems((previous) => previous.filter((item) => item.id !== id));
  }

  function clearAll() {
    setItems([]); setError("");
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    addFiles(event.target.files); event.target.value = "";
  }

  const doneCount = items.filter((item) => item.status === "done").length;
  const totalOriginal = items.reduce((sum, item) => sum + item.file.size, 0);
  const totalCompressed = items.reduce((sum, item) => sum + (item.outputSize ?? item.file.size), 0);

  return <section className="workspace upload-workspace page-shell" aria-label="圖片壓縮工具">
    <div className="panel">
      <span className="privacy-badge background-remover-badge">◱ 圖片不上傳</span>
      <div className={`drop-zone compressor-drop ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { if (busy) { event.preventDefault(); setDragging(false); return; } onDrop(event); }} onClick={() => { if (!busy) inputRef.current?.click(); }} role="button" tabIndex={busy ? -1 : 0} aria-disabled={busy} onKeyDown={(event) => { if (!busy && (event.key === "Enter" || event.key === " ")) inputRef.current?.click(); }}>
        <div><div className="drop-icon" aria-hidden="true">◱</div><h2>{items.length > 0 ? `已加入 ${items.length} 張圖片` : "把圖片拖到這裡"}</h2><p>{busy ? "處理中，完成後可再加入圖片" : "可一次選多張，全部在本機處理"}</p><span className="button button-secondary">{busy ? "處理中…" : items.length > 0 ? "繼續加入" : "選擇圖片"}</span><input ref={inputRef} className="file-input" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={onFileChange} disabled={busy} aria-label="選擇要壓縮的圖片" /><small className="file-note">JPG、PNG、WebP · 每張最大 25 MB · 最多 {MAX_FILES} 張</small></div>
      </div>
      <div className="flow-options compressor-options">
        <label className="field-label" htmlFor="compress-format">輸出格式
          <select id="compress-format" value={format} disabled={busy} onChange={(event) => { setFormat(event.target.value as OutputFormat); requeueFinished(); }}>
            <option value="original">保持原格式</option>
            <option value="jpeg">JPG（相容性高）</option>
            <option value="webp">WebP（通常較小）</option>
            <option value="png">PNG（無損、保留透明）</option>
          </select>
        </label>
        <label className="field-label" htmlFor="compress-max">尺寸上限（長邊）
          <select id="compress-max" value={maxEdge} disabled={busy} onChange={(event) => { setMaxEdge(Number(event.target.value)); requeueFinished(); }}>
            <option value={0}>不縮放</option>
            <option value={4000}>4000 px</option>
            <option value={2000}>2000 px</option>
            <option value={1000}>1000 px</option>
          </select>
        </label>
        {(format === "jpeg" || format === "webp" || format === "original") && (
          <label className="field-label" htmlFor="compress-quality">壓縮品質：{quality}%
            <input id="compress-quality" className="gantt-range" type="range" min={30} max={100} step={5} value={quality} disabled={busy} onChange={(event) => { setQuality(Number(event.target.value)); requeueFinished(); }} />
          </label>
        )}
      </div>
      <button className="button button-blue draw-button" type="button" onClick={compressAll} disabled={busy || items.length === 0}>{busy ? "壓縮中…" : "開始壓縮"}</button>
      {error && <p className="error-message" role="alert">{error}</p>}
    </div>
    <div className="panel panel-tinted">
      <div className="panel-header"><h2>壓縮結果</h2><span className="panel-meta">{doneCount > 0 ? `${doneCount}/${items.length} 完成` : `${items.length} 張待處理`}</span></div>
      {items.length === 0
        ? <div className="result-stage"><div className="result-empty"><strong>批次壓縮</strong>加入圖片後，這裡會列出每張的壓縮前後大小。</div></div>
        : <>
            <ul className="compressor-list">
              {items.map((item) => (
                <li key={item.id} className={`compressor-item compressor-item-${item.status}`}>
                  <div className="compressor-item-info">
                    <strong>{item.file.name}</strong>
                    <span>
                      {formatBytes(item.file.size)}
                      {item.status === "done" && item.outputSize !== undefined && <>{item.keptOriginal ? <>（原檔已經更小，因此保留原始檔案）</> : <> → <b>{formatBytes(item.outputSize)}</b>（省 <CountUp value={savingsPercent(item.file.size, item.outputSize)} startFrom={0} />%{item.width ? ` · ${item.width}×${item.height}` : ""}）</>}</>}
                      {item.status === "working" && " → 壓縮中…"}
                      {item.status === "error" && ` → ${item.message}`}
                    </span>
                  </div>
                  {item.status === "done" && item.outputBlob && item.outputName
                    ? <button className="button button-small button-secondary" type="button" onClick={() => downloadBlob(item.outputBlob!, item.outputName!)}>下載</button>
                    : <button className="gantt-row-delete" type="button" aria-label={`移除 ${item.file.name}`} onClick={() => removeItem(item.id)}>✕</button>}
                </li>
              ))}
            </ul>
            <div className="result-actions">
              {doneCount > 1 && <button className="button button-small button-blue" type="button" onClick={() => { void downloadAll(); }}>下載 ZIP（{doneCount} 張）</button>}
              <button className="button button-small button-secondary" type="button" onClick={clearAll} disabled={busy}>清空</button>
              {doneCount > 0 && <span className="compressor-total">合計 {formatBytes(totalOriginal)} → {formatBytes(totalCompressed)}</span>}
            </div>
          </>}
    </div>
  </section>;
}
