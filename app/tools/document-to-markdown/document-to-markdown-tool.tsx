"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { SaveToWorkspace } from "@/components/save-to-workspace";
import {
  documentMarkdownFilename,
  isSupportedDocument,
  userFacingConversionError,
} from "@/lib/document-to-markdown";

const MAX_SIZE = 50 * 1024 * 1024;

type Output = { blob: Blob; name: string; markdown: string };

type WorkerResponse =
  | { type: "success"; name: string; markdown: string }
  | { type: "error"; name: string; code?: string; message?: string };

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DocumentToMarkdownTool() {
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sourceName, setSourceName] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [output, setOutput] = useState<Output | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => () => workerRef.current?.terminate(), []);

  function getWorker() {
    workerRef.current ??= new Worker(new URL("./document-to-markdown.worker.ts", import.meta.url), { type: "module" });
    return workerRef.current;
  }

  function resetMessages() {
    setError("");
    setNotice("");
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void convertFile(file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void convertFile(file);
  }

  async function convertFile(file: File) {
    resetMessages();
    setOutput(null);
    setMarkdown("");
    setSourceName(file.name);
    if (!isSupportedDocument(file)) {
      setError("不支援這種檔案格式，請選擇 Word、Excel、PowerPoint、PDF、EPUB、RTF、OpenDocument 或 CSV。");
      return;
    }
    if (file.size > MAX_SIZE) {
      setError("檔案超過 50 MB 上限；實際可處理大小仍取決於裝置記憶體。");
      return;
    }

    const requestId = ++requestIdRef.current;
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      const worker = getWorker();
      const result = await new Promise<WorkerResponse>((resolve, reject) => {
        const onMessage = (event: MessageEvent<WorkerResponse>) => {
          if (event.data.name !== file.name) return;
          worker.removeEventListener("message", onMessage);
          worker.removeEventListener("error", onError);
          resolve(event.data);
        };
        const onError = () => {
          worker.removeEventListener("message", onMessage);
          worker.removeEventListener("error", onError);
          reject(new Error("worker"));
        };
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
        worker.postMessage({ type: "convert", name: file.name, bytes }, [bytes]);
      });
      if (requestId !== requestIdRef.current) return;
      if (result.type === "error") {
        setError(userFacingConversionError(result));
        return;
      }
      if (result.markdown.trim() === "") {
        setError("檔案沒有可輸出的文字內容；掃描 PDF 需要 OCR。");
        return;
      }
      const name = documentMarkdownFilename(file.name);
      const blob = new Blob([result.markdown], { type: "text/markdown;charset=utf-8" });
      setMarkdown(result.markdown);
      setOutput({ blob, name, markdown: result.markdown });
      setNotice(`已轉換「${file.name}」，可下載或存到工作區。`);
    } catch {
      if (requestId === requestIdRef.current) setError("轉換元件載入失敗，請重新整理頁面後再試。");
    } finally {
      if (requestId === requestIdRef.current) setBusy(false);
    }
  }

  return (
    <section className="workspace page-shell" aria-label="文件轉 Markdown">
      <div className="panel">
        <div className="panel-header">
          <h2>文件轉 Markdown</h2>
          <span className="panel-meta">本機 WASM · 不上傳</span>
        </div>
        <div
          className={`file-drop-zone${dragging ? " file-drop-zone-active" : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
          onDrop={handleDrop}
        >
          <p className="file-drop-title">拖放文件到這裡</p>
          <p className="key-note">或選擇檔案：DOCX、XLSX、PPTX、PDF、EPUB、RTF、ODF、CSV（上限 50 MB）</p>
          <button className="button button-small button-blue" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? "轉換中…" : "選擇文件"}
          </button>
          <input ref={inputRef} className="file-input" type="file" accept=".doc,.docm,.docx,.epub,.pdf,.pot,.potm,.pps,.ppsm,.ppsx,.ppt,.pptm,.pptx,.rtf,.csv,.ods,.odp,.odt,.xls,.xlsb,.xlsm,.xlsx" onChange={chooseFile} aria-label="選擇要轉換的文件" />
        </div>
        {sourceName && <p className="key-note">來源：{sourceName}</p>}
        {error && <p className="error-message" role="alert">{error}</p>}
        {notice && <p className="gantt-notice-info" role="status">{notice}</p>}
      </div>

      {output && (
        <div className="panel">
          <div className="panel-header">
            <h2>Markdown 結果</h2>
            <span className="panel-meta">{output.name}</span>
          </div>
          <textarea className="participant-input" value={markdown} onChange={(event) => {
            const next = event.target.value;
            setMarkdown(next);
            setOutput((previous) => previous ? { ...previous, markdown: next, blob: new Blob([next], { type: "text/markdown;charset=utf-8" }) } : previous);
          }} aria-label="Markdown 結果" spellCheck={false} />
          <div className="tool-actions">
            <button className="button button-small button-blue" type="button" onClick={() => downloadBlob(output.blob, output.name)}>下載 Markdown</button>
            <SaveToWorkspace blob={output.blob} name={output.name} sourceTool="document-to-markdown" handoffKind="file" />
          </div>
          <p className="key-note">文字型 PDF 可轉換；掃描 PDF 需要 OCR。嵌入圖片初版保留文件文字與圖片替代文字。</p>
        </div>
      )}
    </section>
  );
}
