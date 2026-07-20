"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { extractedFilename, mergedFilename, parsePageRanges } from "@/lib/pdf-pages";
import { formatBytes } from "@/lib/image-compress";

const MAX_FILES = 12;
const MAX_SIZE = 50 * 1024 * 1024;
const MAX_TOTAL_SIZE = 150 * 1024 * 1024;

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
  const [rotations, setRotations] = useState<Record<number, number>>({});
  const [globalRotate, setGlobalRotate] = useState(0);
  const dragIdRef = useRef<string | null>(null);
  const thumbnailRenderIdRef = useRef(0);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function resetMessages() { setError(""); setNotice(""); }

  useEffect(() => () => { thumbnailRenderIdRef.current += 1; }, []);

  function addMergeFiles(event: ChangeEvent<HTMLInputElement>) {
    resetMessages();
    const incoming: MergeItem[] = [];
    let reservedSize = mergeItems.reduce((total, item) => total + item.file.size, 0);
    for (const file of Array.from(event.target.files ?? [])) {
      if (!isPdf(file)) { setError("只支援 PDF 檔案"); continue; }
      if (file.size > MAX_SIZE) { setError(`「${file.name}」超過 50 MB 上限`); continue; }
      if (reservedSize + file.size > MAX_TOTAL_SIZE) { setError(`合併檔案總計上限為 ${MAX_TOTAL_SIZE / 1024 / 1024} MB，未加入後續檔案。`); continue; }
      if (mergeItems.length + incoming.length >= MAX_FILES) { setError(`最多可合併 ${MAX_FILES} 份 PDF。`); continue; }
      reservedSize += file.size;
      incoming.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file });
    }
    setMergeItems((previous) => [...previous, ...incoming]);
    event.target.value = "";
  }

  async function chooseSplitFile(event: ChangeEvent<HTMLInputElement>) {
    const renderId = ++thumbnailRenderIdRef.current;
    resetMessages();
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!isPdf(file)) { setError("只支援 PDF 檔案"); return; }
    if (file.size > MAX_SIZE) { setError("檔案超過 50 MB 上限"); return; }
    setSplitFile(file);
    setSplitPages(null);
    setThumbnails([]);
    setRotations({});
    setGlobalRotate(0);
    setRange("");
    try {
      const buffer = await file.arrayBuffer();
      const { PDFDocument } = await import("pdf-lib");
      const document = await PDFDocument.load(buffer.slice(0), { ignoreEncryption: false });
      if (thumbnailRenderIdRef.current !== renderId) return;
      setSplitPages(document.getPageCount());
      void renderThumbnails(buffer, Math.min(document.getPageCount(), 12), renderId);
    } catch {
      // 換檔後才報錯的舊檔案不可清掉目前已成功載入的新檔案。
      if (thumbnailRenderIdRef.current !== renderId) return;
      setSplitFile(null);
      setError("無法讀取這份 PDF — 檔案可能已加密或損壞");
    }
  }

  /** 用 pdf.js 畫前幾頁縮圖；整段包 12 秒逾時，任何失敗或懸掛都靜默降級（縮圖是輔助，不擋功能）。 */
  async function renderThumbnails(buffer: ArrayBuffer, pageCount: number, renderId: number) {
    const work = async () => {
      const pdfjs = await import("pdfjs-dist");
      // worker 以靜態資產提供（public/pdf.worker.min.mjs，需與 pdfjs-dist 版本一起更新；
      // vinext 與 next build 兩套打包器對 node_modules URL 的解析不一致，靜態路徑最穩）。
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const documentProxy = await pdfjs.getDocument({ data: buffer.slice(0) }).promise;
      const images: string[] = [];
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        if (thumbnailRenderIdRef.current !== renderId) return;
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
        if (thumbnailRenderIdRef.current === renderId) setThumbnails([...images]);
      }
      void documentProxy.cleanup();
    };
    try {
      await Promise.race([
        work(),
        new Promise<never>((_, reject) => { setTimeout(() => reject(new Error("thumbnail timeout")), 12_000); }),
      ]);
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

  function rotatePage(pageNumber: number) {
    setRotations((previous) => {
      const next = ((previous[pageNumber] ?? 0) + 90) % 360;
      const copy = { ...previous };
      if (next === 0) delete copy[pageNumber];
      else copy[pageNumber] = next;
      return copy;
    });
  }

  /** HTML5 拖曳排序；↑↓ 按鈕保留給鍵盤與觸控使用者。 */
  function handleDragOverItem(id: string) {
    const draggingId = dragIdRef.current;
    if (!draggingId || draggingId === id) return;
    setMergeItems((previous) => {
      const fromIndex = previous.findIndex((item) => item.id === draggingId);
      const toIndex = previous.findIndex((item) => item.id === id);
      if (fromIndex < 0 || toIndex < 0) return previous;
      const next = [...previous];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
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
      const { PDFDocument, degrees } = await import("pdf-lib");
      const source = await PDFDocument.load(await splitFile.arrayBuffer());
      const output = await PDFDocument.create();
      const pages = await output.copyPages(source, indexes);
      pages.forEach((page, at) => {
        const extra = rotations[indexes[at] + 1] ?? globalRotate;
        if (extra !== 0) page.setRotation(degrees(((page.getRotation().angle + extra) % 360 + 360) % 360));
        output.addPage(page);
      });
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
      <div className="flow-mode-toggle" role="group" aria-label="PDF 功能">
        <button type="button" className={`button button-small ${mode === "merge" ? "button-blue" : "button-secondary"}`} aria-pressed={mode === "merge"} onClick={() => { setMode("merge"); resetMessages(); }} disabled={busy}>合併多份 PDF</button>
        <button type="button" className={`button button-small ${mode === "split" ? "button-blue" : "button-secondary"}`} aria-pressed={mode === "split"} onClick={() => { setMode("split"); resetMessages(); }} disabled={busy}>取出指定頁面</button>
      </div>
      {mode === "merge"
        ? <>
            <button className="button button-secondary pdf-add-button" type="button" onClick={() => mergeInputRef.current?.click()} disabled={busy || mergeItems.length >= MAX_FILES}>＋ 加入 PDF（{mergeItems.length}/{MAX_FILES}）</button>
            <input ref={mergeInputRef} className="file-input" type="file" accept="application/pdf,.pdf" multiple disabled={busy} onChange={addMergeFiles} aria-label="選擇要合併的 PDF" />
            {mergeItems.length > 0 && (
              <ul className="pdf-merge-list">
                {mergeItems.map((item, index) => (
                  <li
                    key={item.id}
                    className={dragOverId === item.id ? "pdf-merge-dragover" : undefined}
                    draggable
                    onDragStart={() => { if (!busy) dragIdRef.current = item.id; }}
                    onDragOver={(event) => { if (!busy) { event.preventDefault(); setDragOverId(item.id); handleDragOverItem(item.id); } }}
                    onDragEnd={() => { dragIdRef.current = null; setDragOverId(null); }}
                    onDrop={(event) => { event.preventDefault(); dragIdRef.current = null; setDragOverId(null); }}
                  >
                    <span className="pdf-merge-handle" aria-hidden="true">⠿</span>
                    <span className="pdf-merge-order">{index + 1}</span>
                    <span className="pdf-merge-name">{item.file.name}<small>{formatBytes(item.file.size)}</small></span>
                    <span className="pdf-merge-actions">
                      <button className="gantt-row-delete" type="button" aria-label="往上移" disabled={busy || index === 0} onClick={() => moveItem(item.id, -1)}>↑</button>
                      <button className="gantt-row-delete" type="button" aria-label="往下移" disabled={busy || index === mergeItems.length - 1} onClick={() => moveItem(item.id, 1)}>↓</button>
                      <button className="gantt-row-delete" type="button" aria-label={`移除 ${item.file.name}`} disabled={busy} onClick={() => setMergeItems((previous) => previous.filter((entry) => entry.id !== item.id))}>✕</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <button className="button button-blue draw-button" type="button" onClick={mergePdfs} disabled={busy || mergeItems.length < 2}>{busy ? "合併中…" : "合併並下載"}</button>
          </>
        : <>
            <button className="button button-secondary pdf-add-button" type="button" onClick={() => splitInputRef.current?.click()} disabled={busy}>{splitFile ? `已選：${splitFile.name}` : "選擇 PDF"}</button>
            <input ref={splitInputRef} className="file-input" type="file" accept="application/pdf,.pdf" disabled={busy} onChange={chooseSplitFile} aria-label="選擇要取頁的 PDF" />
            {splitPages !== null && <p className="pdf-page-count">共 {splitPages} 頁{thumbnails.length > 0 ? "（點縮圖可加入／移除頁碼）" : ""}</p>}
            {thumbnails.length > 0 && (
              <div className="pdf-thumb-grid">
                {thumbnails.map((thumbnail, index) => (
                  <span className="pdf-thumb-wrap" key={index}>
                    <button type="button" className="pdf-thumb" disabled={busy} onClick={() => toggleThumbnailPage(index + 1)} title={`第 ${index + 1} 頁`}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- 本機 data URL 縮圖 */}
                      <img src={thumbnail} alt={`第 ${index + 1} 頁縮圖`} style={rotations[index + 1] ? { transform: `rotate(${rotations[index + 1]}deg)` } : undefined} />
                      <span>{index + 1}{rotations[index + 1] ? ` ↻${rotations[index + 1]}°` : ""}</span>
                    </button>
                    <button type="button" className="pdf-thumb-rotate" disabled={busy} aria-label={`旋轉第 ${index + 1} 頁`} title="旋轉 90°" onClick={() => rotatePage(index + 1)}>↻</button>
                  </span>
                ))}
              </div>
            )}
            <label className="field-label" htmlFor="pdf-range">要取出的頁碼
              <input id="pdf-range" className="key-input" value={range} disabled={busy} onChange={(event) => setRange(event.target.value)} placeholder="例如 1-3,5" spellCheck={false} />
            </label>
            <label className="field-label" htmlFor="pdf-rotate">旋轉取出的頁面
              <select id="pdf-rotate" className="key-input" value={globalRotate} disabled={busy} onChange={(event) => setGlobalRotate(Number(event.target.value))}>
                <option value={0}>不旋轉</option>
                <option value={90}>順時針 90°</option>
                <option value={180}>180°</option>
                <option value={270}>逆時針 90°</option>
              </select>
            </label>
            {Object.keys(rotations).length > 0 && <p className="key-note">已個別旋轉 {Object.keys(rotations).length} 頁（縮圖上的 ↻）；個別設定優先於整批旋轉。</p>}
            <button className="button button-blue draw-button" type="button" onClick={extractPages} disabled={busy || !splitFile}>{busy ? "處理中…" : "取出並下載"}</button>
          </>}
      {error && <p className="error-message" role="alert">{error}</p>}
      {notice && <p className="gantt-notice gantt-notice-info" role="status">{notice}</p>}
    </div>
    <div className="panel panel-tinted">
      <div className="panel-header"><h2>使用說明</h2><span className="panel-meta">100% 本機處理</span></div>
      <ul className="pdf-help">
        <li><strong>合併</strong>：加入多份 PDF，直接拖曳（或用 ↑↓）調整順序，合併後直接下載，原始檔不會離開你的裝置。</li>
        <li><strong>取頁</strong>：頁碼支援單頁與範圍，例如 <code>1-3,5</code>；<code>8-6</code> 會照 8、7、6 的順序輸出，可用來倒轉頁序。點縮圖右上角的 ↻ 可個別旋轉頁面，或用「旋轉取出的頁面」整批旋轉。</li>
              <li>加密的 PDF 需要先解除密碼才能處理；每份檔案上限 50 MB，全部檔案合計上限 150 MB。</li>
      </ul>
    </div>
  </section>;
}
