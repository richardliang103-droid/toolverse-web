"use client";

import { ChangeEvent, useRef, useState } from "react";
import { extractedFilename, mergedFilename, parsePageRanges } from "@/lib/pdf-pages";
import { formatBytes } from "@/lib/image-compress";

const MAX_FILES = 12;
const MAX_SIZE = 50 * 1024 * 1024;

type PdfMode = "merge" | "split";

type MergeItem = { id: string; file: File };

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isPdf(file: File) {
  return file.type === "application/pdf" || (file.type === "" && /\.pdf$/i.test(file.name));
}

export function PdfToolkitTool() {
  const mergeInputRef = useRef<HTMLInputElement>(null);
  const splitInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<PdfMode>("merge");
  const [mergeItems, setMergeItems] = useState<MergeItem[]>([]);
  const [splitFile, setSplitFile] = useState<File | null>(null);
  const [splitPages, setSplitPages] = useState<number | null>(null);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [range, setRange] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function resetMessages() { setError(""); setNotice(""); }

  function addMergeFiles(event: ChangeEvent<HTMLInputElement>) {
    resetMessages();
    const incoming: MergeItem[] = [];
    for (const file of Array.from(event.target.files ?? [])) {
      if (!isPdf(file)) { setError("只支援 PDF 檔案"); continue; }
      if (file.size > MAX_SIZE) { setError(`「${file.name}」超過 50 MB 上限`); continue; }
      incoming.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file });
    }
    setMergeItems((previous) => [...previous, ...incoming].slice(0, MAX_FILES));
    event.target.value = "";
  }

  async function chooseSplitFile(event: ChangeEvent<HTMLInputElement>) {
    resetMessages();
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!isPdf(file)) { setError("只支援 PDF 檔案"); return; }
    if (file.size > MAX_SIZE) { setError("檔案超過 50 MB 上限"); return; }
    setSplitFile(file);
    setSplitPages(null);
    setThumbnails([]);
    try {
      const buffer = await file.arrayBuffer();
      const { PDFDocument } = await import("pdf-lib");
      const document = await PDFDocument.load(buffer.slice(0), { ignoreEncryption: false });
      setSplitPages(document.getPageCount());
      void renderThumbnails(buffer, Math.min(document.getPageCount(), 12));
    } catch {
      setSplitFile(null);
      setError("無法讀取這份 PDF — 檔案可能已加密或損壞");
    }
  }

  /** 用 pdf.js 畫前幾頁縮圖；任何失敗都靜默略過（縮圖是輔助，不擋功能）。 */
  async function renderThumbnails(buffer: ArrayBuffer, pageCount: number) {
    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const documentProxy = await pdfjs.getDocument({ data: buffer.slice(0) }).promise;
      const images: string[] = [];
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const page = await documentProxy.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const scale = 120 / viewport.width;
        const scaled = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(scaled.width);
        canvas.height = Math.ceil(scaled.height);
        const context = canvas.getContext("2d");
        if (!context) break;
        await page.render({ canvas, canvasContext: context, viewport: scaled }).promise;
        images.push(canvas.toDataURL("image/jpeg", 0.7));
        setThumbnails([...images]);
      }
      void documentProxy.cleanup();
    } catch { /* 縮圖失敗不影響取頁 */ }
  }

  function toggleThumbnailPage(pageNumber: number) {
    setRange((previous) => {
      const parts = previous.split(/[,，、]/).map((part) => part.trim()).filter(Boolean);
      const token = String(pageNumber);
      if (parts.includes(token)) return parts.filter((part) => part !== token).join(",");
      return [...parts, token].join(",");
    });
  }

  function moveItem(id: string, direction: -1 | 1) {
    setMergeItems((previous) => {
      const index = previous.findIndex((item) => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function mergePdfs() {
    if (mergeItems.length < 2) { setError("請至少加入兩份 PDF"); return; }
    setBusy(true); resetMessages();
    try {
      const { PDFDocument } = await import("pdf-lib");
      const output = await PDFDocument.create();
      for (const item of mergeItems) {
        const source = await PDFDocument.load(await item.file.arrayBuffer());
        const pages = await output.copyPages(source, source.getPageIndices());
        for (const page of pages) output.addPage(page);
      }
      const bytes = await output.save();
      downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), mergedFilename(mergeItems.map((item) => item.file.name)));
      setNotice(`已合併 ${mergeItems.length} 份、共 ${output.getPageCount()} 頁`);
    } catch {
      setError("合併失敗 — 其中一份 PDF 可能已加密或損壞");
    } finally {
      setBusy(false);
    }
  }

  async function extractPages() {
    if (!splitFile || splitPages === null) { setError("請先選擇 PDF"); return; }
    setBusy(true); resetMessages();
    try {
      const indexes = parsePageRanges(range, splitPages);
      const { PDFDocument } = await import("pdf-lib");
      const source = await PDFDocument.load(await splitFile.arrayBuffer());
      const output = await PDFDocument.create();
      const pages = await output.copyPages(source, indexes);
      for (const page of pages) output.addPage(page);
      const bytes = await output.save();
      downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), extractedFilename(splitFile.name));
      setNotice(`已取出 ${indexes.length} 頁`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "取出頁面失敗");
    } finally {
      setBusy(false);
    }
  }

  return <section className="workspace pdf-workspace page-shell" aria-label="PDF 工具">
    <div className="panel">
      <span className="privacy-badge background-remover-badge">⧉ 檔案不上傳</span>
      <div className="flow-mode-toggle" role="radiogroup" aria-label="PDF 功能">
        <button type="button" className={`button button-small ${mode === "merge" ? "button-blue" : "button-secondary"}`} aria-pressed={mode === "merge"} onClick={() => { setMode("merge"); resetMessages(); }} disabled={busy}>合併多份 PDF</button>
        <button type="button" className={`button button-small ${mode === "split" ? "button-blue" : "button-secondary"}`} aria-pressed={mode === "split"} onClick={() => { setMode("split"); resetMessages(); }} disabled={busy}>取出指定頁面</button>
      </div>
      {mode === "merge"
        ? <>
            <button className="button button-secondary pdf-add-button" type="button" onClick={() => mergeInputRef.current?.click()} disabled={busy || mergeItems.length >= MAX_FILES}>＋ 加入 PDF（{mergeItems.length}/{MAX_FILES}）</button>
            <input ref={mergeInputRef} className="file-input" type="file" accept="application/pdf,.pdf" multiple onChange={addMergeFiles} aria-label="選擇要合併的 PDF" />
            {mergeItems.length > 0 && (
              <ul className="pdf-merge-list">
                {mergeItems.map((item, index) => (
                  <li key={item.id}>
                    <span className="pdf-merge-order">{index + 1}</span>
                    <span className="pdf-merge-name">{item.file.name}<small>{formatBytes(item.file.size)}</small></span>
                    <span className="pdf-merge-actions">
                      <button className="gantt-row-delete" type="button" aria-label="往上移" disabled={index === 0} onClick={() => moveItem(item.id, -1)}>↑</button>
                      <button className="gantt-row-delete" type="button" aria-label="往下移" disabled={index === mergeItems.length - 1} onClick={() => moveItem(item.id, 1)}>↓</button>
                      <button className="gantt-row-delete" type="button" aria-label={`移除 ${item.file.name}`} onClick={() => setMergeItems((previous) => previous.filter((entry) => entry.id !== item.id))}>✕</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <button className="button button-blue draw-button" type="button" onClick={mergePdfs} disabled={busy || mergeItems.length < 2}>{busy ? "合併中…" : "合併並下載"}</button>
          </>
        : <>
            <button className="button button-secondary pdf-add-button" type="button" onClick={() => splitInputRef.current?.click()} disabled={busy}>{splitFile ? `已選：${splitFile.name}` : "選擇 PDF"}</button>
            <input ref={splitInputRef} className="file-input" type="file" accept="application/pdf,.pdf" onChange={chooseSplitFile} aria-label="選擇要取頁的 PDF" />
            {splitPages !== null && <p className="pdf-page-count">共 {splitPages} 頁{thumbnails.length > 0 ? "（點縮圖可加入／移除頁碼）" : ""}</p>}
            {thumbnails.length > 0 && (
              <div className="pdf-thumb-grid">
                {thumbnails.map((thumbnail, index) => (
                  <button type="button" className="pdf-thumb" key={index} onClick={() => toggleThumbnailPage(index + 1)} title={`第 ${index + 1} 頁`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- 本機 data URL 縮圖 */}
                    <img src={thumbnail} alt={`第 ${index + 1} 頁縮圖`} />
                    <span>{index + 1}</span>
                  </button>
                ))}
              </div>
            )}
            <label className="field-label" htmlFor="pdf-range">要取出的頁碼
              <input id="pdf-range" className="key-input" value={range} onChange={(event) => setRange(event.target.value)} placeholder="例如 1-3,5" spellCheck={false} />
            </label>
            <button className="button button-blue draw-button" type="button" onClick={extractPages} disabled={busy || !splitFile}>{busy ? "處理中…" : "取出並下載"}</button>
          </>}
      {error && <p className="error-message" role="alert">{error}</p>}
      {notice && <p className="gantt-notice gantt-notice-info" role="status">{notice}</p>}
    </div>
    <div className="panel panel-tinted">
      <div className="panel-header"><h2>使用說明</h2><span className="panel-meta">100% 本機處理</span></div>
      <ul className="pdf-help">
        <li><strong>合併</strong>：加入多份 PDF、用 ↑↓ 調整順序，合併後直接下載，原始檔不會離開你的裝置。</li>
        <li><strong>取頁</strong>：頁碼支援單頁與範圍，例如 <code>1-3,5</code>；<code>8-6</code> 會照 8、7、6 的順序輸出，可用來倒轉頁序。</li>
        <li>加密的 PDF 需要先解除密碼才能處理；每份檔案上限 50 MB。</li>
      </ul>
    </div>
  </section>;
}
