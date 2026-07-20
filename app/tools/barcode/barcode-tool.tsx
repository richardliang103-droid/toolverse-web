"use client";

import { useEffect, useRef, useState } from "react";
import { barcodeFilename, validateBarcode, type BarcodeFormat } from "@/lib/barcode";

const STORAGE_KEY = "toolverse:barcode:v1";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BarcodeTool() {
  const [format, setFormat] = useState<BarcodeFormat>("CODE128");
  const [text, setText] = useState("TOOLVERSE-001");
  const [showText, setShowText] = useState(true);
  const [error, setError] = useState("");
  const [encoded, setEncoded] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const svgHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved) as Record<string, unknown>;
        // 還原上次的內容需要一次性的 client hydration。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (typeof data.text === "string" && data.text) setText(data.text.slice(0, 80));
        if (data.format === "EAN13") setFormat("EAN13");
        if (data.showText === false) setShowText(false);
      }
    } catch { localStorage.removeItem(STORAGE_KEY); }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify({ text, format, showText }));
  }, [hydrated, text, format, showText]);

  useEffect(() => {
    if (!hydrated) return;
    const host = svgHostRef.current;
    if (!host) return;
    const timer = setTimeout(() => {
      const { value, error: message } = validateBarcode(format, text);
      if (!value) {
        setError(text.trim() ? message ?? "" : "");
        setEncoded("");
        host.innerHTML = "";
        return;
      }
      void (async () => {
        try {
          const JsBarcode = (await import("jsbarcode")).default;
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          JsBarcode(svg, value, {
            format,
            displayValue: showText,
            margin: 12,
            height: 90,
            fontSize: 15,
            font: "Inter, 'Noto Sans TC', sans-serif",
            lineColor: "#101628",
            background: "#ffffff",
          });
          host.innerHTML = "";
          host.appendChild(svg);
          setEncoded(value);
          setError("");
        } catch {
          setError("無法編碼這段內容，請檢查格式");
          setEncoded("");
        }
      })();
    }, 150);
    return () => clearTimeout(timer);
  }, [hydrated, format, text, showText]);

  function currentSvgMarkup() {
    const svg = svgHostRef.current?.querySelector("svg");
    if (!svg) return "";
    const clone = svg.cloneNode(true) as SVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    return clone.outerHTML;
  }

  function downloadSvg() {
    const markup = currentSvgMarkup();
    if (markup) downloadBlob(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }), `${barcodeFilename(encoded)}.svg`);
  }

  function downloadPng() {
    const markup = currentSvgMarkup();
    const svg = svgHostRef.current?.querySelector("svg");
    if (!markup || !svg) return;
    const width = (svg.width.baseVal.value || 300) * 3;
    const height = (svg.height.baseVal.value || 130) * 3;
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      canvas.toBlob((blob) => { if (blob) downloadBlob(blob, `${barcodeFilename(encoded)}.png`); }, "image/png");
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  }

  return <section className="workspace barcode-workspace page-shell" aria-label="條碼產生器">
    <div className="panel">
      <div className="panel-header"><h2>內容與格式</h2><span className="panel-meta">{text.trim().length}/80</span></div>
      <div className="flow-mode-toggle" role="group" aria-label="條碼格式">
        <button type="button" className={`button button-small ${format === "CODE128" ? "button-blue" : "button-secondary"}`} aria-pressed={format === "CODE128"} onClick={() => setFormat("CODE128")}>Code 128（通用）</button>
        <button type="button" className={`button button-small ${format === "EAN13" ? "button-blue" : "button-secondary"}`} aria-pressed={format === "EAN13"} onClick={() => { setFormat("EAN13"); if (!/^\d+$/.test(text.trim())) setText("471234567890"); }}>EAN-13（商品）</button>
      </div>
      <label className="field-label" htmlFor="barcode-text">{format === "CODE128" ? "條碼內容（英數字與符號）" : "商品碼（12 或 13 位數字）"}
        <input id="barcode-text" className="key-input" maxLength={80} value={text} onChange={(event) => setText(event.target.value)} placeholder={format === "CODE128" ? "例如 ORDER-2026-0719" : "例如 471234567890"} spellCheck={false} />
      </label>
      <label className="check-row"><input type="checkbox" checked={showText} onChange={(event) => setShowText(event.target.checked)} />條碼下方顯示文字</label>
      {format === "EAN13" && <p className="key-note">輸入 12 位會自動算出第 13 位檢查碼；輸入 13 位會驗證檢查碼是否正確。台灣商品條碼以 471 開頭。</p>}
      {error && <p className="error-message" role="alert">{error}</p>}
      <p className="key-note">條碼在瀏覽器本機產生，內容不上傳；列印前建議用掃描器實測一次。</p>
    </div>
    <div className="panel panel-tinted">
      <div className="panel-header"><h2>預覽</h2><span className="panel-meta">{encoded ? `已編碼：${encoded}` : "即時更新"}</span></div>
      <div className={`barcode-preview${encoded ? "" : " barcode-preview-empty"}`}>
        <div ref={svgHostRef} className="barcode-svg-host" aria-label="條碼預覽" role="img" />
        {!encoded && <div className="result-empty"><strong>輸入內容就會出現</strong>支援 Code 128 與 EAN-13，可下載 PNG、SVG。</div>}
      </div>
      {encoded && (
        <div className="result-actions">
          <button className="button button-small button-blue" type="button" onClick={downloadPng}>下載 PNG</button>
          <button className="button button-small button-secondary" type="button" onClick={downloadSvg}>下載 SVG</button>
        </div>
      )}
    </div>
  </section>;
}
