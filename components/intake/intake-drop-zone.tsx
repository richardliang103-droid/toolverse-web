"use client";

import { useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from "react";

type IntakeDropZoneProps = {
  text: string;
  onTextChange: (text: string) => void;
  onFiles: (files: FileList) => void;
  busy: boolean;
};

/**
 * Smart Intake 的輸入面：貼上文字或拖放／選取檔案，兩種入口共用同一個框。
 *
 * 純粹負責收集輸入與轉發事件，偵測與推薦邏輯都在上層——這裡沒有任何判斷格式
 * 的程式碼，方便單獨檢視互動是否正確，不必連著一大串偵測規則一起看。
 */
export function IntakeDropZone({ text, onTextChange, onFiles, busy }: IntakeDropZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 0) onFiles(event.dataTransfer.files);
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files && event.target.files.length > 0) onFiles(event.target.files);
    event.target.value = "";
  }

  // 貼上圖片（例如截圖）時 clipboard 是檔案而不是文字，兩種都要接得住。
  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.files];
    if (files.length === 0) return;
    event.preventDefault();
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    onFiles(transfer.files);
  }

  return (
    <div
      className={dragging ? "intake dragging" : "intake"}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <label className="sr-only" htmlFor="smart-intake-input">貼上文字，或拖放檔案</label>
      <textarea
        id="smart-intake-input"
        className="intake-textarea"
        placeholder="貼上文字，或把檔案拖到這裡……"
        value={text}
        disabled={busy}
        onChange={(event) => onTextChange(event.target.value)}
        onPaste={onPaste}
      />
      <div className="intake-actions">
        <button className="button button-secondary button-small" type="button" disabled={busy} onClick={() => inputRef.current?.click()}>選擇檔案</button>
        <input ref={inputRef} className="file-input" type="file" multiple onChange={onPick} disabled={busy} aria-label="選擇要分析的檔案" />
        <span className="intake-hint">內容只在瀏覽器裡分析，不會上傳。</span>
      </div>
    </div>
  );
}
