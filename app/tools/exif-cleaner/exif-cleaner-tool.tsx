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
  const [items, setItems] = useState<CleanItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

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
    setError("");
    const accepted: File[] = [];
    for (const file of Array.from(list)) {
      const looksRight = ["image/jpeg", "image/png"].includes(file.type) || (file.type === "" && /\.(jpe?g|png)$/i.test(file.name));
      if (!looksRight) { setError("目前支援 JPG 與 PNG（無損處理）；HEIC 等格式請先轉檔"); continue; }
      if (file.size > MAX_SIZE) { setError(`「${file.name}」超過 50 MB 上限`); continue; }
      accepted.push(file);
    }
    const processed = await Promise.all(accepted.map(processFile));
    setItems((previous) => [...previous, ...processed].slice(0, MAX_FILES));
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

  return <section className="workspace upload-workspace page-shell" aria-label="照片隱私清除工具">
    <div className="panel">
      <span className="privacy-badge background-remover-badge">◉ 照片不上傳</span>
      <div className={`drop-zone compressor-drop ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}>
        <div><div className="drop-icon" aria-hidden="true">◉</div><h2>{items.length > 0 ? `已處理 ${items.length} 張照片` : "把照片拖到這裡"}</h2><p>放進來就會自動移除 metadata</p><span className="button button-secondary">{items.length > 0 ? "繼續加入" : "選擇照片"}</span><input ref={inputRef} className="file-input" type="file" accept="image/jpeg,image/png" multiple onChange={onFileChange} aria-label="選擇要清除隱私資訊的照片" /><small className="file-note">JPG、PNG · 每張最大 50 MB · 最多 {MAX_FILES} 張</small></div>
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}
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
              <button className="button button-small button-secondary" type="button" onClick={() => { setItems([]); setError(""); }}>清空</button>
            </div>
          </>}
    </div>
  </section>;
}
