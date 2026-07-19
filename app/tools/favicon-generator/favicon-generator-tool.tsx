"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { FAVICON_SIZES, faviconHtmlSnippet, faviconInitials, faviconManifestSnippet } from "@/lib/favicon";

const STORAGE_KEY = "toolverse:favicon-generator:v1";
const RENDER = 512; // 主畫布邊長，其餘尺寸由它縮出

type Mode = "text" | "image";
type Shape = "circle" | "rounded" | "square";

type StoredState = { mode: Mode; text: string; bg: string; fg: string; shape: Shape };

function sanitizeStoredState(value: unknown): StoredState {
  const data = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const hex = (input: unknown, fallback: string) => (typeof input === "string" && /^#[0-9a-f]{6}$/i.test(input) ? input : fallback);
  return {
    mode: data.mode === "image" ? "image" : "text",
    text: typeof data.text === "string" ? data.text.slice(0, 8) : "T",
    bg: hex(data.bg, "#3557ff"),
    fg: hex(data.fg, "#ffffff"),
    shape: data.shape === "square" || data.shape === "rounded" ? data.shape : "circle",
  };
}

function drawBackground(context: CanvasRenderingContext2D, size: number, bg: string, shape: Shape) {
  context.clearRect(0, 0, size, size);
  context.fillStyle = bg;
  if (shape === "square") {
    context.fillRect(0, 0, size, size);
  } else if (shape === "rounded") {
    const radius = size * 0.22;
    context.beginPath();
    context.roundRect(0, 0, size, size, radius);
    context.fill();
  } else {
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    context.fill();
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FaviconGeneratorTool() {
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("T");
  const [bg, setBg] = useState("#3557ff");
  const [fg, setFg] = useState("#ffffff");
  const [shape, setShape] = useState<Shape>("circle");
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"html" | "manifest" | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const paint = useCallback((size: number, target?: CanvasRenderingContext2D) => {
    const canvas = target ? null : document.createElement("canvas");
    const context = target ?? canvas!.getContext("2d");
    if (!context) return null;
    if (canvas) { canvas.width = size; canvas.height = size; }
    if (mode === "image" && image) {
      const ratio = Math.max(size / image.naturalWidth, size / image.naturalHeight);
      const drawW = image.naturalWidth * ratio;
      const drawH = image.naturalHeight * ratio;
      context.clearRect(0, 0, size, size);
      context.drawImage(image, (size - drawW) / 2, (size - drawH) / 2, drawW, drawH);
    } else {
      drawBackground(context, size, bg, shape);
      const label = faviconInitials(text) || "T";
      context.fillStyle = fg;
      context.textAlign = "center";
      context.textBaseline = "middle";
      const fontSize = label.length > 1 ? size * 0.46 : size * 0.6;
      context.font = `800 ${fontSize}px Inter, "Noto Sans TC", sans-serif`;
      context.fillText(label, size / 2, size / 2 + size * 0.04);
    }
    return canvas;
  }, [mode, image, bg, fg, shape, text]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = sanitizeStoredState(JSON.parse(saved));
        // 還原偏好需要一次性的 client hydration；圖片模式不還原（圖不留存）。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMode("text"); setText(data.text); setBg(data.bg); setFg(data.fg); setShape(data.shape);
      }
    } catch { localStorage.removeItem(STORAGE_KEY); }
     
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: "text", text, bg, fg, shape }));
  }, [hydrated, text, bg, fg, shape]);

  // 重繪主預覽畫布。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = RENDER;
    canvas.height = RENDER;
    const context = canvas.getContext("2d");
    if (!context) return;
    paint(RENDER, context);
    setPreview(canvas.toDataURL("image/png"));
  }, [paint]);

  function onImageChange(event: ChangeEvent<HTMLInputElement>) {
    setError("");
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\//.test(file.type)) { setError("請選擇圖片檔"); return; }
    if (file.size > 5 * 1024 * 1024) { setError("圖片請小於 5 MB"); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { setImage(img); setMode("image"); URL.revokeObjectURL(url); };
    img.onerror = () => { setError("無法讀取這張圖片"); URL.revokeObjectURL(url); };
    img.src = url;
  }

  function downloadSize(size: number, filename: string) {
    const canvas = paint(size);
    if (!canvas) { setError("產生失敗，請重試"); return; }
    canvas.toBlob((blob) => { if (blob) downloadBlob(blob, filename); }, "image/png");
  }

  function downloadAll() {
    for (const item of FAVICON_SIZES) downloadSize(item.size, item.filename);
  }

  async function copySnippet(kind: "html" | "manifest") {
    try {
      await navigator.clipboard.writeText(kind === "html" ? faviconHtmlSnippet() : faviconManifestSnippet());
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2400);
    } catch {
      setError("無法複製到剪貼簿，請手動選取");
    }
  }

  return <section className="workspace favicon-workspace page-shell" aria-label="Favicon 產生器">
    <div className="panel">
      <div className="flow-mode-toggle" role="radiogroup" aria-label="來源">
        <button type="button" className={`button button-small ${mode === "text" ? "button-blue" : "button-secondary"}`} aria-pressed={mode === "text"} onClick={() => setMode("text")}>文字／emoji</button>
        <button type="button" className={`button button-small ${mode === "image" ? "button-blue" : "button-secondary"}`} aria-pressed={mode === "image"} onClick={() => setMode("image")}>上傳圖片</button>
      </div>
      {mode === "text" ? (
        <>
          <label className="field-label favicon-field" htmlFor="fav-text">文字或 emoji（最多兩字）
            <input id="fav-text" className="key-input" value={text} maxLength={8} onChange={(event) => setText(event.target.value)} placeholder="T、日、🚀" />
          </label>
          <div className="qr-option-grid">
            <label className="field-label" htmlFor="fav-bg">背景色<span className="qr-color-row"><input id="fav-bg" type="color" value={bg} onChange={(event) => setBg(event.target.value)} /><code>{bg}</code></span></label>
            <label className="field-label" htmlFor="fav-fg">文字色<span className="qr-color-row"><input id="fav-fg" type="color" value={fg} onChange={(event) => setFg(event.target.value)} /><code>{fg}</code></span></label>
          </div>
          <div className="flow-mode-toggle favicon-shapes" role="radiogroup" aria-label="形狀">
            {(["circle", "rounded", "square"] as Shape[]).map((option) => (
              <button key={option} type="button" className={`button button-small ${shape === option ? "button-blue" : "button-secondary"}`} aria-pressed={shape === option} onClick={() => setShape(option)}>{option === "circle" ? "圓形" : option === "rounded" ? "圓角" : "方形"}</button>
            ))}
          </div>
        </>
      ) : (
        <>
          <label className="field-label favicon-field" htmlFor="fav-image">選擇圖片
            <input id="fav-image" className="key-input" type="file" accept="image/*" onChange={onImageChange} />
          </label>
          <p className="key-note">圖片會置中裁切成正方形；建議用去背後的透明 PNG 或方形圖。圖片只在本機處理，不會上傳。</p>
        </>
      )}
      {error && <p className="error-message" role="alert">{error}</p>}
    </div>
    <div className="panel panel-tinted">
      <div className="panel-header"><h2>預覽與下載</h2><span className="panel-meta">本機產生</span></div>
      <div className="favicon-previews">
        {preview && [512, 180, 48, 32, 16].map((size) => (
          <div className="favicon-preview-item" key={size}>
            {/* eslint-disable-next-line @next/next/no-img-element -- 本機 data URL 預覽 */}
            <img src={preview} alt={`${size}px 預覽`} style={{ width: Math.min(size, 96), height: Math.min(size, 96) }} />
            <span>{size}px</span>
          </div>
        ))}
      </div>
      <div className="result-actions">
        <button className="button button-small button-blue" type="button" onClick={downloadAll} disabled={!preview}>下載全套 PNG</button>
      </div>
      <div className="favicon-snippets">
        <details><summary>HTML &lt;head&gt; 片段</summary><pre>{faviconHtmlSnippet()}</pre><button className="button button-small button-secondary" type="button" onClick={() => copySnippet("html")}>{copied === "html" ? "已複製 ✓" : "複製 HTML"}</button></details>
        <details><summary>web manifest 片段</summary><pre>{faviconManifestSnippet()}</pre><button className="button button-small button-secondary" type="button" onClick={() => copySnippet("manifest")}>{copied === "manifest" ? "已複製 ✓" : "複製 manifest"}</button></details>
      </div>
      <canvas ref={canvasRef} className="favicon-hidden-canvas" aria-hidden="true" />
    </div>
  </section>;
}
