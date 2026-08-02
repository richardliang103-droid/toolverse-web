"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  BACKGROUND_PRESETS,
  CANVAS_RATIOS,
  DEFAULT_BACKGROUND_ID,
  DEFAULT_RATIO_ID,
  PADDING_DEFAULT_PERCENT,
  PADDING_MAX_PERCENT,
  PADDING_MIN_PERCENT,
  RADIUS_DEFAULT_PERCENT,
  RADIUS_MAX_PERCENT,
  RADIUS_MIN_PERCENT,
  SHADOW_DEFAULT_STRENGTH,
  SHADOW_MAX_STRENGTH,
  WAIRO,
  backgroundCss,
  canvasRatioOf,
  computeFrameLayout,
  computeShadow,
  getBackground,
  gradientEndpoints,
  outputFileName,
  resolveCornerRadius,
  type FrameLayout,
  type ScreenshotBackground,
} from "@/lib/screenshot-frame";
import { exceedsImagePixelLimit, imagePixelLimitMessage } from "@/lib/image-limits";
import { IMAGE_TOOL_SLUGS, toHandoffFile } from "@/lib/handoff";
import { SendToTools } from "@/components/send-to-tools";
import { SaveToWorkspace } from "@/components/save-to-workspace";
import { HandoffStatusBanner } from "@/components/handoff-status";
import { useHandoff } from "@/components/use-handoff";

const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SIZE = 25 * 1024 * 1024;

/** 預覽畫布的長邊上限；版面計算與輸出共用同一組函式，只是解析度不同。 */
const PREVIEW_MAX_EDGE = 520;

/** 設定變動到重算輸出檔之間的緩衝，避免拖拉滑桿時每一格都全解析度重畫。 */
const OUTPUT_DEBOUNCE_MS = 220;

type PaintOptions = {
  background: ScreenshotBackground;
  radiusPercent: number;
  shadow: boolean;
  shadowStrength: number;
  /** JPG 不支援透明，透明背景要先補一層底色，否則會變成黑塊。 */
  opaqueFallback: string | null;
};

/** 手動描圓角矩形；不依賴 `roundRect`，舊一點的 Safari 也畫得出來。 */
function traceRoundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.arcTo(x + width, y, x + width, y + r, r);
  context.lineTo(x + width, y + height - r);
  context.arcTo(x + width, y + height, x + width - r, y + height, r);
  context.lineTo(x + r, y + height);
  context.arcTo(x, y + height, x, y + height - r, r);
  context.lineTo(x, y + r);
  context.arcTo(x, y, x + r, y, r);
  context.closePath();
}

/**
 * 把一張圖畫成「背景＋留白＋圓角＋陰影」的成品。
 *
 * 座標全部來自 `computeFrameLayout()`，所以預覽與輸出走的是同一段程式碼，
 * 只差在傳進來的 layout 解析度不同——看到什麼就會下載到什麼。
 */
function paintFrame(context: CanvasRenderingContext2D, image: CanvasImageSource, layout: FrameLayout, options: PaintOptions) {
  const { canvas, image: rect } = layout;
  context.clearRect(0, 0, canvas.width, canvas.height);

  const { background } = options;
  if (background.kind === "gradient") {
    const { x0, y0, x1, y1 } = gradientEndpoints(background.angle, canvas);
    const gradient = context.createLinearGradient(x0, y0, x1, y1);
    const lastStop = Math.max(1, background.stops.length - 1);
    background.stops.forEach((color, index) => gradient.addColorStop(index / lastStop, color));
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
  } else if (background.kind === "solid") {
    context.fillStyle = background.color;
    context.fillRect(0, 0, canvas.width, canvas.height);
  } else if (options.opaqueFallback !== null) {
    context.fillStyle = options.opaqueFallback;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  const radius = resolveCornerRadius(options.radiusPercent, rect);

  if (options.shadow) {
    const shadow = computeShadow(options.shadowStrength, rect);
    if (shadow.blur > 0 || shadow.offsetY > 0) {
      // 先用實心圓角矩形投影，再把圖片疊上去；直接對 drawImage 設陰影的話，
      // 半透明 PNG 會連內容一起投影，邊緣會糊掉。
      context.save();
      context.shadowColor = shadow.color;
      context.shadowBlur = shadow.blur;
      context.shadowOffsetY = shadow.offsetY;
      context.fillStyle = "#101628";
      traceRoundedRect(context, rect.x, rect.y, rect.width, rect.height, radius);
      context.fill();
      context.restore();
    }
  }

  context.save();
  traceRoundedRect(context, rect.x, rect.y, rect.width, rect.height, radius);
  context.clip();
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
  context.restore();
}

export function ScreenshotBeautifierTool() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const loadOperationRef = useRef(0);
  const outputOperationRef = useRef(0);

  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState("");
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [backgroundId, setBackgroundId] = useState(DEFAULT_BACKGROUND_ID);
  const [ratioId, setRatioId] = useState<string>(DEFAULT_RATIO_ID);
  const [paddingPercent, setPaddingPercent] = useState(PADDING_DEFAULT_PERCENT);
  const [radiusPercent, setRadiusPercent] = useState(RADIUS_DEFAULT_PERCENT);
  const [shadowOn, setShadowOn] = useState(true);
  const [shadowStrength, setShadowStrength] = useState(SHADOW_DEFAULT_STRENGTH);
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [error, setError] = useState("");

  const background = getBackground(backgroundId);
  const ratio = canvasRatioOf(ratioId);

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
        // 遞增 id 防止「先選的大圖後解碼完」蓋掉後選的圖；catch／error 分支同樣要檢查。
        if (loadOperationRef.current !== operationId) return;
        if (exceedsImagePixelLimit(image.naturalWidth, image.naturalHeight)) { setError(imagePixelLimitMessage()); return; }
        imageRef.current = image;
        setSource(reader.result as string);
        setFileName(file.name);
        setNatural({ w: image.naturalWidth, h: image.naturalHeight });
        setOutputBlob(null);
      };
      image.onerror = () => { if (loadOperationRef.current === operationId) setError("無法讀取這張圖片"); };
      image.src = reader.result as string;
    };
    reader.onerror = () => { if (loadOperationRef.current === operationId) setError("無法讀取這個檔案"); };
    reader.readAsDataURL(file);
  }, []);

  const handoffStatus = useHandoff("screenshot-beautifier", (file) => loadFile(file));

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    loadFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    loadFile(event.dataTransfer.files?.[0]);
  }

  const outputLayout = useMemo(
    () => computeFrameLayout({ width: natural.w, height: natural.h }, { paddingPercent, ratio }),
    [natural.w, natural.h, paddingPercent, ratio],
  );

  // 預覽：跟輸出共用 computeFrameLayout／paintFrame，只把長邊上限換成螢幕尺寸。
  useEffect(() => {
    const canvasElement = previewRef.current;
    const image = imageRef.current;
    if (!canvasElement || !image || source === "" || natural.w === 0) return;
    const layout = computeFrameLayout({ width: natural.w, height: natural.h }, { paddingPercent, ratio, maxEdge: PREVIEW_MAX_EDGE });
    canvasElement.width = layout.canvas.width;
    canvasElement.height = layout.canvas.height;
    const context = canvasElement.getContext("2d");
    if (!context) return;
    paintFrame(context, image, layout, { background, radiusPercent, shadow: shadowOn, shadowStrength, opaqueFallback: null });
  }, [source, natural.w, natural.h, paddingPercent, ratio, background, radiusPercent, shadowOn, shadowStrength]);

  const renderOutput = useCallback(async (): Promise<Blob | null> => {
    const image = imageRef.current;
    if (!image || natural.w === 0) return null;
    const canvasElement = document.createElement("canvas");
    canvasElement.width = outputLayout.canvas.width;
    canvasElement.height = outputLayout.canvas.height;
    const context = canvasElement.getContext("2d");
    if (!context) return null;
    paintFrame(context, image, outputLayout, {
      background,
      radiusPercent,
      shadow: shadowOn,
      shadowStrength,
      opaqueFallback: format === "jpeg" ? WAIRO.washi : null,
    });
    return await new Promise<Blob | null>((resolve) => {
      canvasElement.toBlob((blob) => resolve(blob), format === "png" ? "image/png" : "image/jpeg", 0.92);
    });
  }, [natural.w, outputLayout, background, radiusPercent, shadowOn, shadowStrength, format]);

  // 「存到工作區」需要現成的 Blob，這裡在設定停下來之後補算一份。下載與「送到」
  // 走 renderOutput() 現算，永遠是最新設定；這份只是給工作區按鈕用的。
  // 換圖時由 loadFile 負責清掉舊的 Blob，這裡只管重算，不在 effect 裡直接 setState。
  useEffect(() => {
    if (source === "") return;
    const operationId = ++outputOperationRef.current;
    const timer = window.setTimeout(() => {
      void renderOutput()
        .then((blob) => { if (outputOperationRef.current === operationId) setOutputBlob(blob); })
        .catch(() => { if (outputOperationRef.current === operationId) setOutputBlob(null); });
    }, OUTPUT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [source, renderOutput]);

  const outputName = outputFileName(fileName, format);

  async function download() {
    const blob = await renderOutput();
    if (!blob) { setError("輸出失敗，請重試"); return; }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = outputName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handoffFile() {
    const blob = await renderOutput();
    if (!blob) { setError("輸出失敗，請重試"); return null; }
    return toHandoffFile(blob, outputName);
  }

  const cornerRadiusPx = resolveCornerRadius(radiusPercent, outputLayout.image);

  return <section className="workspace shot-workspace page-shell" aria-label="截圖美化工具">
    <div className="panel">
      <div className="panel-header"><h2>截圖與樣式</h2><span className="panel-meta">不上傳、本機合成</span></div>
      {source === "" && (
        <div className="crop-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
          <p><strong>把截圖拖到這裡</strong></p>
          <p className="key-note">或</p>
          <button className="button button-small button-blue" type="button" onClick={() => inputRef.current?.click()}>選擇圖片</button>
          <p className="key-note">支援 JPG、PNG、WebP，上限 25 MB</p>
        </div>
      )}
      <input ref={inputRef} className="file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={onPick} aria-label="選擇要美化的截圖" />
      {source !== "" && (
        <>
          <fieldset className="shot-fieldset">
            <legend className="field-label">背景樣式</legend>
            <div className="shot-swatch-grid">
              {BACKGROUND_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`shot-swatch${backgroundId === preset.id ? " on" : ""}`}
                  aria-pressed={backgroundId === preset.id}
                  onClick={() => setBackgroundId(preset.id)}
                >
                  <span
                    className={`shot-swatch-chip${preset.kind === "transparent" ? " shot-swatch-chip-transparent" : ""}`}
                    style={preset.kind === "transparent" ? undefined : { background: backgroundCss(preset) }}
                  />
                  <span className="shot-swatch-label">{preset.label}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="shot-fieldset">
            <legend className="field-label">畫布比例</legend>
            <div className="flow-mode-toggle crop-aspect-row">
              {CANVAS_RATIOS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`button button-small ${ratioId === item.id ? "button-blue" : "button-secondary"}`}
                  aria-pressed={ratioId === item.id}
                  onClick={() => setRatioId(item.id)}
                >{item.label}</button>
              ))}
            </div>
          </fieldset>

          <label className="field-label" htmlFor="shot-padding">留白：{paddingPercent}%
            <input id="shot-padding" className="gantt-range" type="range" min={PADDING_MIN_PERCENT} max={PADDING_MAX_PERCENT} step={1} value={paddingPercent} onChange={(event) => setPaddingPercent(Number(event.target.value))} />
          </label>
          <label className="field-label" htmlFor="shot-radius">圓角：{radiusPercent}%（約 {cornerRadiusPx} px）
            <input id="shot-radius" className="gantt-range" type="range" min={RADIUS_MIN_PERCENT} max={RADIUS_MAX_PERCENT} step={1} value={radiusPercent} onChange={(event) => setRadiusPercent(Number(event.target.value))} />
          </label>
          <label className="shot-toggle" htmlFor="shot-shadow">
            <input id="shot-shadow" type="checkbox" checked={shadowOn} onChange={(event) => setShadowOn(event.target.checked)} />
            <span>加上陰影</span>
          </label>
          {shadowOn && (
            <label className="field-label" htmlFor="shot-shadow-strength">陰影強度：{shadowStrength}
              <input id="shot-shadow-strength" className="gantt-range" type="range" min={5} max={SHADOW_MAX_STRENGTH} step={5} value={shadowStrength} onChange={(event) => setShadowStrength(Number(event.target.value))} />
            </label>
          )}
          <label className="field-label" htmlFor="shot-format">輸出格式
            <select id="shot-format" className="key-input" value={format} onChange={(event) => setFormat(event.target.value as "png" | "jpeg")}>
              <option value="png">PNG（無損、可保留透明）</option>
              <option value="jpeg">JPG（較小、不支援透明）</option>
            </select>
          </label>

          <div className="result-actions">
            <button className="button button-small button-blue" type="button" onClick={() => { void download(); }}>下載美化結果</button>
            <button className="button button-small button-secondary" type="button" onClick={() => inputRef.current?.click()}>換一張圖</button>
          </div>
          <p className="key-note">
            輸出尺寸：{outputLayout.canvas.width} × {outputLayout.canvas.height} px（原圖 {natural.w} × {natural.h}）
            {outputLayout.scale < 1 && "，已等比縮到畫布長邊上限"}
            {background.kind === "transparent" && format === "jpeg" && "。JPG 不支援透明，透明區域會補上和紙白底。"}
          </p>
          <SendToTools from="screenshot-beautifier" targets={IMAGE_TOOL_SLUGS} getFile={handoffFile} />
          <SaveToWorkspace blob={outputBlob} name={outputName} sourceTool="screenshot-beautifier" handoffKind="file" />
        </>
      )}
      {error !== "" && <p className="error-message" role="alert">{error}</p>}
      <HandoffStatusBanner status={handoffStatus} />
    </div>
    <div className="panel panel-tinted">
      <div className="panel-header"><h2>預覽</h2><span className="panel-meta">{source !== "" ? "即時更新" : "尚未選擇圖片"}</span></div>
      <div className="shot-preview-stage">
        {source !== ""
          ? <canvas ref={previewRef} className="shot-preview-canvas" aria-label="美化後的截圖預覽" role="img" />
          : <div className="result-empty"><strong>選一張截圖開始</strong>加上和色漸層背景、留白、圓角與陰影，輸出社群常用的 1:1、16:9、9:16 尺寸。</div>}
      </div>
    </div>
  </section>;
}
