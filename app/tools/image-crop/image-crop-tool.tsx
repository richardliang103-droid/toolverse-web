"use client";

import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { CROP_MIN_SIZE, applyAspect, clampCropRect, toNaturalRect, type CropRect } from "@/lib/crop";
import { exceedsImagePixelLimit, imagePixelLimitMessage } from "@/lib/image-limits";

const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SIZE = 25 * 1024 * 1024;

const ASPECTS: Array<{ id: string; label: string; ratio: number | null }> = [
  { id: "free", label: "自由", ratio: null },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "3:4", label: "3:4", ratio: 3 / 4 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
];

type DragMode = { kind: "move" | "nw" | "ne" | "sw" | "se"; startX: number; startY: number; origin: CropRect };

export function ImageCropTool() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragMode | null>(null);
  const loadOperationRef = useRef(0);
  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState("");
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [display, setDisplay] = useState({ w: 0, h: 0 });
  const [rect, setRect] = useState<CropRect>({ x: 0, y: 0, w: 0, h: 0 });
  const [aspectId, setAspectId] = useState("free");
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [error, setError] = useState("");

  const loadFile = useCallback((file: File | undefined) => {
    const operationId = ++loadOperationRef.current;
    setError("");
    if (!file) return;
    if (!ACCEPTED.has(file.type) && !(file.type === "" && /\.(jpe?g|png|webp)$/i.test(file.name))) { setError("支援 JPG、PNG、WebP 圖片"); return; }
    if (file.size > MAX_SIZE) { setError("圖片超過 25 MB 上限"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (loadOperationRef.current !== operationId) return;
      if (typeof reader.result !== "string") return;
      const image = new Image();
      image.onload = () => {
        if (loadOperationRef.current !== operationId) return;
        if (exceedsImagePixelLimit(image.naturalWidth, image.naturalHeight)) { setError(imagePixelLimitMessage()); return; }
        setSource(reader.result as string);
        setFileName(file.name);
        setNatural({ w: image.naturalWidth, h: image.naturalHeight });
        const maxW = Math.min(560, frameRef.current?.clientWidth || 560);
        const scale = Math.min(1, maxW / image.naturalWidth);
        const w = Math.round(image.naturalWidth * scale);
        const h = Math.round(image.naturalHeight * scale);
        setDisplay({ w, h });
        setRect({ x: Math.round(w * 0.1), y: Math.round(h * 0.1), w: Math.round(w * 0.8), h: Math.round(h * 0.8) });
        setAspectId("free");
      };
      image.onerror = () => { if (loadOperationRef.current === operationId) setError("無法讀取這張圖片"); };
      image.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    loadFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    loadFile(event.dataTransfer.files?.[0]);
  }

  function pickAspect(id: string) {
    setAspectId(id);
    const ratio = ASPECTS.find((item) => item.id === id)?.ratio;
    if (ratio) setRect((previous) => applyAspect(previous, ratio, display.w, display.h));
  }

  function updateRect(patch: Partial<CropRect>) {
    setRect((previous) => clampCropRect({ ...previous, ...patch }, display.w, display.h));
  }

  function startDrag(event: React.PointerEvent, kind: DragMode["kind"]) {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    dragRef.current = { kind, startX: event.clientX, startY: event.clientY, origin: rect };
  }

  function onDragMove(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const ratio = ASPECTS.find((item) => item.id === aspectId)?.ratio ?? null;
    const { origin } = drag;
    let next: CropRect;
    if (drag.kind === "move") {
      next = { ...origin, x: origin.x + dx, y: origin.y + dy };
    } else {
      const left = drag.kind === "nw" || drag.kind === "sw";
      const top = drag.kind === "nw" || drag.kind === "ne";
      let w = origin.w + (left ? -dx : dx);
      let h = origin.h + (top ? -dy : dy);
      w = Math.max(CROP_MIN_SIZE, w);
      h = Math.max(CROP_MIN_SIZE, h);
      if (ratio) h = w / ratio;
      next = {
        x: left ? origin.x + origin.w - w : origin.x,
        y: top ? origin.y + origin.h - h : origin.y,
        w,
        h,
      };
    }
    setRect(clampCropRect(next, display.w, display.h));
  }

  function endDrag() { dragRef.current = null; }

  function download() {
    if (!source || natural.w === 0) return;
    const scale = natural.w / display.w;
    const target = toNaturalRect(rect, scale, natural.w, natural.h);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = target.w;
      canvas.height = target.h;
      const context = canvas.getContext("2d");
      if (!context) return;
      if (format === "jpeg") { context.fillStyle = "#ffffff"; context.fillRect(0, 0, target.w, target.h); }
      context.drawImage(image, target.x, target.y, target.w, target.h, 0, 0, target.w, target.h);
      canvas.toBlob((blob) => {
        if (!blob) { setError("輸出失敗，請重試"); return; }
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${fileName.replace(/\.[^.]+$/, "") || "cropped"}-裁切.${format === "png" ? "png" : "jpg"}`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, format === "png" ? "image/png" : "image/jpeg", 0.92);
    };
    image.src = source;
  }

  const scale = display.w > 0 ? natural.w / display.w : 1;
  const outputSize = source ? toNaturalRect(rect, scale, natural.w, natural.h) : null;

  return <section className="workspace crop-workspace page-shell" aria-label="圖片裁切工具">
    <div className="panel">
      <div className="panel-header"><h2>圖片與比例</h2><span className="panel-meta">不上傳、本機裁切</span></div>
      {!source && (
        <div className="crop-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
          <p><strong>把圖片拖到這裡</strong></p>
          <p className="key-note">或</p>
          <button className="button button-small button-blue" type="button" onClick={() => inputRef.current?.click()}>選擇圖片</button>
          <p className="key-note">支援 JPG、PNG、WebP，上限 25 MB</p>
        </div>
      )}
      <input ref={inputRef} className="file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={onPick} aria-label="選擇要裁切的圖片" />
      {source && (
        <>
          <div className="flow-mode-toggle crop-aspect-row" role="group" aria-label="裁切比例">
            {ASPECTS.map((item) => (
              <button key={item.id} type="button" className={`button button-small ${aspectId === item.id ? "button-blue" : "button-secondary"}`} aria-pressed={aspectId === item.id} onClick={() => pickAspect(item.id)}>{item.label}</button>
            ))}
          </div>
          <label className="field-label" htmlFor="crop-format">輸出格式
            <select id="crop-format" className="key-input" value={format} onChange={(event) => setFormat(event.target.value as "png" | "jpeg")}>
              <option value="png">PNG（無損）</option>
              <option value="jpeg">JPG（較小）</option>
            </select>
          </label>
          <div className="crop-number-grid" aria-label="裁切區域數值設定">
            <label className="field-label" htmlFor="crop-x">X
              <input id="crop-x" className="number-input" type="number" min={0} max={display.w} value={Math.round(rect.x)} onChange={(event) => updateRect({ x: Number(event.target.value) || 0 })} />
            </label>
            <label className="field-label" htmlFor="crop-y">Y
              <input id="crop-y" className="number-input" type="number" min={0} max={display.h} value={Math.round(rect.y)} onChange={(event) => updateRect({ y: Number(event.target.value) || 0 })} />
            </label>
            <label className="field-label" htmlFor="crop-width">寬
              <input id="crop-width" className="number-input" type="number" min={CROP_MIN_SIZE} max={display.w} value={Math.round(rect.w)} onChange={(event) => updateRect({ w: Number(event.target.value) || CROP_MIN_SIZE })} />
            </label>
            <label className="field-label" htmlFor="crop-height">高
              <input id="crop-height" className="number-input" type="number" min={CROP_MIN_SIZE} max={display.h} value={Math.round(rect.h)} onChange={(event) => updateRect({ h: Number(event.target.value) || CROP_MIN_SIZE })} />
            </label>
          </div>
          <div className="result-actions">
            <button className="button button-small button-blue" type="button" onClick={download}>下載裁切結果</button>
            <button className="button button-small button-secondary" type="button" onClick={() => inputRef.current?.click()}>換一張圖</button>
          </div>
          {outputSize && <p className="key-note">輸出尺寸：{outputSize.w} × {outputSize.h} px（原圖 {natural.w} × {natural.h}）。拖曳框內移動、拖曳四角縮放。</p>}
        </>
      )}
      {error && <p className="error-message" role="alert">{error}</p>}
    </div>
    <div className="panel panel-tinted">
      <div className="panel-header"><h2>裁切區域</h2><span className="panel-meta">{source ? "拖曳調整" : "尚未選擇圖片"}</span></div>
      <div ref={frameRef} className="crop-frame-host">
        {source
          ? <div className="crop-frame" style={{ width: display.w, height: display.h }} onPointerMove={onDragMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 本機 data URL 預覽 */}
              <img src={source} alt="待裁切圖片" width={display.w} height={display.h} draggable={false} />
              <div
                className="crop-box"
                style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
                onPointerDown={(event) => startDrag(event, "move")}
                role="presentation"
              >
                <span className="crop-handle crop-handle-nw" onPointerDown={(event) => startDrag(event, "nw")} />
                <span className="crop-handle crop-handle-ne" onPointerDown={(event) => startDrag(event, "ne")} />
                <span className="crop-handle crop-handle-sw" onPointerDown={(event) => startDrag(event, "sw")} />
                <span className="crop-handle crop-handle-se" onPointerDown={(event) => startDrag(event, "se")} />
              </div>
            </div>
          : <div className="result-stage"><div className="result-empty"><strong>選擇圖片後開始裁切</strong>支援固定比例（1:1、16:9…）或自由框選，輸出 PNG／JPG。</div></div>}
      </div>
    </div>
  </section>;
}
