"use client";

import { ChangeEvent, DragEvent, useRef, useState } from "react";
import { cleanedFilename, stripImageMetadata } from "@/lib/exif-clean";
import type { RemovedSegment } from "@/lib/exif-clean";
import { formatBytes } from "@/lib/image-compress";

const MAX_FILES = 20;
const MAX_SIZE = 50 * 1024 * 1024;

type ItemStatus = "done" | "clean" | "error";

type CleanItem = {
  id: string;
  file: File;
  status: ItemStatus;
  outputBlob?: Blob;
  outputName?: string;
  removed: RemovedSegment[];
  message?: string;
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExifCleanerTool() {
  const inputRef = useRef<HTMLInputElement>(null);
  // 併發加入時先預留名額，避免兩批同時看到相同的 items.length 而突破上限。
  const reservedRef = useRef(0);
  const [processingCount, setProcessingCount] = useState(0);
  const [items, setItems] = useState<CleanItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function processFile(file: File): Promise<CleanItem> {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { cleaned, removed } = stripImageMetadata(bytes);
      if (removed.length === 0) return { id, file, status: "clean", removed };
      return {
        id,
        file,
        status: "done",
        removed,
        outputBlob: new Blob([cleaned.buffer.slice(cleaned.byteOffset, cleaned.byteOffset + cleaned.byteLength) as ArrayBuffer], { type: file.type || "application/octet-stream" }),
        outputName: cleanedFilename(file.name),
      };
    } catch (caught) {
      return { id, file, status: "error", removed: [], message: caught instanceof Error ? caught.message : "處理失敗" };
    }
  }

  async function addFiles(list: FileList | null) {
    if (!list) return;
    setError(""); setNotice("");
    const accepted: File[] = [];
    for (const file of Array.from(list)) {
      const looksRight = ["image/jpeg", "image/png"].includes(file.type) || (file.type === "" && /\.(jpe?g|png)$/i.test(file.name));
      if (!looksRight) { setError("目前支援 JPG 與 PNG（無損處理）；HEIC 等格式請先轉檔"); continue; }
      if (file.size > MAX_SIZE) { setError(`「${file.name}」超過 50 MB 上限`); continue; }
      accepted.push(file);
    }
    const remaining = Math.max(0, MAX_FILES - items.length - reservedRef.current);
    const filesToProcess = accepted.slice(0, remaining);
    const skipped = accepted.length - filesToProcess.length;
    if (skipped > 0) setNotice(`已加入前 ${filesToProcess.length} 張，其餘 ${skipped} 張未處理（上限 ${MAX_FILES} 張）。`);
    if (filesToProcess.length === 0) return;
    reservedRef.current += filesToProcess.length;
    setProcessingCount((previous) => previous + filesToProcess.length);
    try {
      const processed: CleanItem[] = new Array(filesToProcess.length);
      let nextIndex = 0;
      await Promise.all(Array.from({ length: Math.min(3, filesToProcess.length) }, async () => {
        while (nextIndex < filesToProcess.length) {
          const index = nextIndex;
          nextIndex += 1;
          processed[index] = await processFile(filesToProcess[index]);
        }
      }));
      setItems((previous) => [...previous, ...processed]);
    } finally {
      reservedRef.current -= filesToProcess.length;
      setProcessingCount((previous) => previous - filesToProcess.length);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setDragging(false); void addFiles(event.dataTransfer.files);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    void addFiles(event.target.files); event.target.value = "";
  }

  function downloadAll() {
    for (const item of items) {
      if (item.status === "done" && item.outputBlob && item.outputName) downloadBlob(item.outputBlob, item.outputName);
    }
  }

  const doneCount = items.filter((item) => item.status === "done").length;
  const busy = processingCount > 0;

  return <section className="workspace upload-workspace page-shell" aria-label="照片隱私清除工具">
    <div className="panel">
      <span className="privacy-badge background-remover-badge">◉ 照片不上傳</span>
      <div className={`drop-zone compressor-drop ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { if (busy) { event.preventDefault(); setDragging(false); return; } onDrop(event); }} onClick={() => { if (!busy) inputRef.current?.click(); }} role="button" tabIndex={busy ? -1 : 0} aria-disabled={busy} onKeyDown={(event) => { if (!busy && (event.key === "Enter" || event.key === " ")) inputRef.current?.click(); }}>
        <div><div className="drop-icon" aria-hidden="true">◉</div><h2>{busy ? `處理中（${processingCount} 張）…` : items.length > 0 ? `已處理 ${items.length} 張照片` : "把照片拖到這裡"}</h2><p>{busy ? "處理完成後可再加入照片" : "放進來就會自動移除 metadata"}</p><span className="button button-secondary">{busy ? "處理中…" : items.length > 0 ? "繼續加入" : "選擇照片"}</span><input ref={inputRef} className="file-input" type="file" accept="image/jpeg,image/png" multiple onChange={onFileChange} disabled={busy} aria-label="選擇要清除隱私資訊的照片" /><small className="file-note">JPG、PNG · 每張最大 50 MB · 最多 {MAX_FILES} 張</small></div>
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}
      {notice && <p className="gantt-notice gantt-notice-info" role="status">{notice}</p>}
      <div className="service-notice service-notice-private"><strong>無損處理，畫質不變</strong><span>只移除 EXIF（GPS 位置、拍攝時間、相機資訊）、IPTC、XMP 與註解等 metadata 區段，不重新壓縮影像；色彩描述檔（ICC）會保留，顏色不會跑掉。</span></div>
    </div>
    <div className="panel panel-tinted">
      <div className="panel-header"><h2>清除結果</h2><span className="panel-meta">{items.length > 0 ? `${doneCount} 張已清除` : "等待照片"}</span></div>
      {items.length === 0
        ? <div className="result-stage"><div className="result-empty"><strong>照片會洩漏的比你想的多</strong>手機拍的照片通常帶著 GPS 位置與拍攝時間；上傳前先在這裡清乾淨。</div></div>
        : <>
            <ul className="compressor-list">
              {items.map((item) => (
                <li key={item.id} className={`compressor-item compressor-item-${item.status === "error" ? "error" : "done"}`}>
                  <div className="compressor-item-info">
                    <strong>{item.file.name}</strong>
                    {item.status === "done" && <span>移除了 {item.removed.map((segment) => `${segment.label}（${formatBytes(segment.bytes)}）`).join("、")}</span>}
                    {item.status === "clean" && <span>本來就沒有 metadata，不需要處理 ✓</span>}
                    {item.status === "error" && <span>{item.message}</span>}
                  </div>
                  {item.status === "done" && item.outputBlob && item.outputName && (
                    <button className="button button-small button-secondary" type="button" onClick={() => downloadBlob(item.outputBlob!, item.outputName!)}>下載</button>
                  )}
                </li>
              ))}
            </ul>
            <div className="result-actions">
              {doneCount > 1 && <button className="button button-small button-blue" type="button" onClick={downloadAll}>全部下載（{doneCount} 張）</button>}
              <button className="button button-small button-secondary" type="button" onClick={() => { setItems([]); setError(""); setNotice(""); }} disabled={busy}>清空</button>
            </div>
          </>}
    </div>
  </section>;
}
