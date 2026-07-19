"use client";

import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { formatBytes } from "@/lib/image-compress";

const MAX_FILES = 20;
const MAX_SIZE = 25 * 1024 * 1024;
const INPUT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp", "image/svg+xml"]);

type TargetFormat = "png" | "jpeg" | "webp";

type Item = {
  id: string;
  file: File;
  status: "pending" | "done" | "error";
  outputUrl?: string;
  outputSize?: number;
  width?: number;
  height?: number;
};

const FORMAT_LABEL: Record<TargetFormat, string> = { png: "PNG", jpeg: "JPG", webp: "WebP" };

function outputName(name: string, format: TargetFormat) {
  return `${name.replace(/\.[^.]+$/, "") || "image"}.${format === "jpeg" ? "jpg" : format}`;
}

export function ImageConverterTool() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [format, setFormat] = useState<TargetFormat>("webp");
  const [quality, setQuality] = useState(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function addFiles(list: FileList | null) {
    setError("");
    const incoming: Item[] = [];
    for (const file of Array.from(list ?? [])) {
      if (!INPUT_TYPES.has(file.type)) { setError(`「${file.name}」格式不支援`); continue; }
      if (file.size > MAX_SIZE) { setError(`「${file.name}」超過 25 MB 上限`); continue; }
      incoming.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file, status: "pending" });
    }
    setItems((previous) => [...previous, ...incoming].slice(0, MAX_FILES));
  }

  function loadImage(file: File) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode failed")); };
      image.src = url;
    });
  }

  async function convertAll() {
    setBusy(true);
    setError("");
    for (const item of items) {
      if (item.status === "done") continue;
      try {
        const image = await loadImage(item.file);
        // SVG 沒有固有像素時以 1024px 寬點陣化
        const width = image.naturalWidth || 1024;
        const height = image.naturalHeight || Math.round(1024 * ((image.height || 1) / (image.width || 1)));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no canvas");
        if (format === "jpeg") { context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height); }
        context.drawImage(image, 0, 0, width, height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, `image/${format}`, format === "png" ? undefined : quality / 100));
        if (!blob) throw new Error("encode failed");
        const outputUrl = URL.createObjectURL(blob);
        setItems((previous) => previous.map((entry) => (entry.id === item.id ? { ...entry, status: "done", outputUrl, outputSize: blob.size, width, height } : entry)));
      } catch {
        setItems((previous) => previous.map((entry) => (entry.id === item.id ? { ...entry, status: "error" } : entry)));
      }
    }
    setBusy(false);
  }

  function downloadAll() {
    for (const item of items) {
      if (item.status !== "done" || !item.outputUrl) continue;
      const anchor = document.createElement("a");
      anchor.href = item.outputUrl;
      anchor.download = outputName(item.file.name, format);
      anchor.click();
    }
  }

  const doneCount = items.filter((item) => item.status === "done").length;

  return <section className="workspace converter-workspace page-shell" aria-label="圖片格式轉換工具">
    <div className="panel">
      <span className="privacy-badge background-remover-badge">⇋ 圖片不上傳</span>
      <div
        className="crop-dropzone converter-dropzone"
        onDragOver={(event: DragEvent) => event.preventDefault()}
        onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); addFiles(event.dataTransfer.files); }}
      >
        <p><strong>把圖片拖到這裡</strong></p>
        <p className="key-note">或</p>
        <button className="button button-small button-blue" type="button" onClick={() => inputRef.current?.click()} disabled={busy || items.length >= MAX_FILES}>選擇圖片（{items.length}/{MAX_FILES}）</button>
        <p className="key-note">輸入：JPG、PNG、WebP、GIF、BMP、SVG · 每張上限 25 MB</p>
      </div>
      <input ref={inputRef} className="file-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/svg+xml" multiple onChange={(event: ChangeEvent<HTMLInputElement>) => { addFiles(event.target.files); event.target.value = ""; }} aria-label="選擇要轉換的圖片" />
      <div className="converter-options">
        <label className="field-label" htmlFor="converter-format">輸出格式
          <select id="converter-format" className="key-input" value={format} onChange={(event) => { setFormat(event.target.value as TargetFormat); setItems((previous) => previous.map((item) => ({ ...item, status: "pending", outputUrl: undefined, outputSize: undefined }))); }}>
            <option value="webp">WebP（最小）</option>
            <option value="png">PNG（無損、透明）</option>
            <option value="jpeg">JPG（相容性最好）</option>
          </select>
        </label>
        {format !== "png" && (
          <label className="field-label" htmlFor="converter-quality">品質：{quality}%
            <input id="converter-quality" type="range" min={40} max={100} step={5} value={quality} onChange={(event) => setQuality(Number(event.target.value))} />
          </label>
        )}
      </div>
      <button className="button button-blue draw-button" type="button" onClick={convertAll} disabled={busy || items.length === 0}>{busy ? "轉換中…" : `轉換成 ${FORMAT_LABEL[format]}`}</button>
      {error && <p className="error-message" role="alert">{error}</p>}
      <p className="key-note">GIF 只取第一格；JPG 不支援透明，透明區域會補白底；SVG 以 1024px 寬點陣化。</p>
    </div>
    <div className="panel panel-tinted">
      <div className="panel-header"><h2>轉換結果</h2><span className="panel-meta">{items.length > 0 ? `${doneCount}/${items.length} 完成` : "批次處理"}</span></div>
      {items.length === 0
        ? <div className="result-stage"><div className="result-empty"><strong>加入圖片後開始轉換</strong>每張會顯示轉換前後大小，可逐張或全部下載。</div></div>
        : <>
            <ul className="compressor-list">
              {items.map((item) => (
                <li className={`compressor-item${item.status === "done" ? " compressor-item-done" : item.status === "error" ? " compressor-item-error" : ""}`} key={item.id}>
                  <span className="pdf-merge-name">{item.file.name}<small>{formatBytes(item.file.size)}{item.status === "done" && item.outputSize !== undefined && <> → <b>{formatBytes(item.outputSize)}</b>{item.width ? ` · ${item.width}×${item.height}` : ""}</>}{item.status === "error" && " · 轉換失敗"}</small></span>
                  <span className="pdf-merge-actions">
                    {item.status === "done" && item.outputUrl && <a className="button button-small button-secondary" href={item.outputUrl} download={outputName(item.file.name, format)}>下載</a>}
                    <button className="gantt-row-delete" type="button" aria-label={`移除 ${item.file.name}`} onClick={() => setItems((previous) => previous.filter((entry) => entry.id !== item.id))}>✕</button>
                  </span>
                </li>
              ))}
            </ul>
            {doneCount > 1 && <div className="result-actions"><button className="button button-small button-blue" type="button" onClick={downloadAll}>全部下載（{doneCount} 張）</button></div>}
          </>}
    </div>
  </section>;
}
