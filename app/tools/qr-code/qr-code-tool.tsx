"use client";

import { useEffect, useRef, useState } from "react";
import { QR_MAX_LENGTH, contrastWarning, qrFilename } from "@/lib/qr";
import { smsPayload, vcardPayload, wifiPayload, type WifiAuth } from "@/lib/qr-templates";
import type { QrErrorLevel } from "@/lib/qr";

const STORAGE_KEY = "toolverse:qr-code:v1";
const SIZES = [256, 512, 1024] as const;

type StoredState = { dark: string; light: string; level: QrErrorLevel; size: number };

type QrTemplate = "free" | "wifi" | "vcard" | "sms";

const TEMPLATES: Array<{ id: QrTemplate; label: string }> = [
  { id: "free", label: "自由輸入" },
  { id: "wifi", label: "Wi-Fi 分享" },
  { id: "vcard", label: "名片 vCard" },
  { id: "sms", label: "簡訊" },
];

function sanitizeStoredState(value: unknown): StoredState {
  const data = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const hex = (input: unknown, fallback: string) => (typeof input === "string" && /^#[0-9a-f]{6}$/i.test(input) ? input : fallback);
  return {
    dark: hex(data.dark, "#101628"),
    light: hex(data.light, "#ffffff"),
    level: data.level === "L" || data.level === "Q" || data.level === "H" ? data.level : "M",
    size: data.size === 256 || data.size === 1024 ? data.size : 512,
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("logo 載入失敗"));
    image.src = source;
  });
}

/** 把 logo 疊在 QR 中央（含背景色墊片）；容錯 H 之下遮住中央 ~8% 面積仍可掃描。 */
async function composeLogoPng(qrDataUrl: string, logoDataUrl: string, size: number, lightHex: string) {
  const [qr, logo] = await Promise.all([loadImage(qrDataUrl), loadImage(logoDataUrl)]);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return qrDataUrl;
  context.drawImage(qr, 0, 0, size, size);
  const logoBox = Math.round(size * 0.2);
  const pad = Math.round(logoBox * 0.16);
  const box = logoBox + pad * 2;
  const origin = Math.round((size - box) / 2);
  context.fillStyle = lightHex;
  context.beginPath();
  context.roundRect(origin, origin, box, box, Math.round(box * 0.18));
  context.fill();
  const ratio = Math.min(logoBox / logo.naturalWidth, logoBox / logo.naturalHeight);
  const drawW = logo.naturalWidth * ratio;
  const drawH = logo.naturalHeight * ratio;
  context.drawImage(logo, (size - drawW) / 2, (size - drawH) / 2, drawW, drawH);
  return canvas.toDataURL("image/png");
}

/** SVG 版：以模組座標把墊片與 logo 注入 svg 字串。 */
function composeLogoSvg(svgMarkup: string, logoDataUrl: string, lightHex: string) {
  const viewBox = svgMarkup.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
  if (!viewBox) return svgMarkup;
  const units = Number(viewBox[1]);
  const box = units * 0.26;
  const origin = (units - box) / 2;
  const logoBox = units * 0.2;
  const logoOrigin = (units - logoBox) / 2;
  const injection = `<rect x="${origin}" y="${origin}" width="${box}" height="${box}" rx="${box * 0.18}" fill="${lightHex}"/><image href="${logoDataUrl}" x="${logoOrigin}" y="${logoOrigin}" width="${logoBox}" height="${logoBox}" preserveAspectRatio="xMidYMid meet"/>`;
  return svgMarkup.replace("</svg>", `${injection}</svg>`);
}

export function QrCodeTool() {
  const [text, setText] = useState("https://toolverse-web.vercel.app");
  const [dark, setDark] = useState("#101628");
  const [light, setLight] = useState("#ffffff");
  const [level, setLevel] = useState<QrErrorLevel>("M");
  const [size, setSize] = useState(512);
  const [dataUrl, setDataUrl] = useState("");
  const [svgMarkup, setSvgMarkup] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [logo, setLogo] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [template, setTemplate] = useState<QrTemplate>("free");
  const [wifi, setWifi] = useState({ ssid: "", password: "", auth: "WPA" as WifiAuth });
  const [vcard, setVcard] = useState({ name: "", phone: "", email: "", org: "", url: "" });
  const [sms, setSms] = useState({ phone: "", message: "" });
  const renderSeq = useRef(0);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = sanitizeStoredState(JSON.parse(saved));
        // 不保存 QR 內容：Wi-Fi 密碼、名片與簡訊都可能是敏感資料。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDark(data.dark); setLight(data.light); setLevel(data.level); setSize(data.size);
      }
    } catch { localStorage.removeItem(STORAGE_KEY); }
     
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ dark, light, level, size }));
  }, [hydrated, dark, light, level, size]);

  useEffect(() => {
    if (!hydrated) return;
    const trimmed = text.trim();
    const sequence = ++renderSeq.current;
    const timer = setTimeout(() => {
      if (!trimmed) { setDataUrl(""); setSvgMarkup(""); setError(""); return; }
      void (async () => {
        try {
          const QRCode = (await import("qrcode")).default;
          const options = { errorCorrectionLevel: logo ? ("H" as const) : level, margin: 2, color: { dark, light } };
          let [png, svg] = await Promise.all([
            QRCode.toDataURL(trimmed, { ...options, width: size }),
            QRCode.toString(trimmed, { ...options, type: "svg" as const }),
          ]);
          if (logo) {
            png = await composeLogoPng(png, logo, size, light);
            svg = composeLogoSvg(svg, logo, light);
          }
          if (renderSeq.current !== sequence) return;
          setDataUrl(png); setSvgMarkup(svg); setError("");
        } catch {
          if (renderSeq.current !== sequence) return;
          setError("內容太長或無法編碼，請縮短文字或降低容錯等級");
        }
      })();
    }, 200);
    return () => clearTimeout(timer);
  }, [hydrated, text, dark, light, level, size, logo]);

  const warning = contrastWarning(dark, light);

  // 模板欄位一變就把組好的 payload 填進內容框；使用者仍可切回自由輸入手動微調。
  function applyWifi(next: typeof wifi) { setWifi(next); if (next.ssid.trim()) setText(wifiPayload(next.ssid, next.password, next.auth)); }
  function applyVcard(next: typeof vcard) { setVcard(next); if (next.name.trim()) setText(vcardPayload(next)); }
  function applySms(next: typeof sms) { setSms(next); if (next.phone.trim()) setText(smsPayload(next.phone, next.message)); }

  function downloadPng() {
    if (!dataUrl) return;
    fetch(dataUrl).then((response) => response.blob()).then((blob) => downloadBlob(blob, `${qrFilename(text)}.png`)).catch(() => setError("下載失敗，請重試"));
  }

  function downloadSvg() {
    if (!svgMarkup) return;
    downloadBlob(new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" }), `${qrFilename(text)}.svg`);
  }

  async function copyPng() {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      setError("無法複製到剪貼簿，請改用下載 PNG");
    }
  }

  return <section className="workspace qr-workspace page-shell" aria-label="QR Code 產生器">
    <div className="panel">
      <div className="panel-header"><h2>內容與樣式</h2><span className="panel-meta">{text.trim().length}/{QR_MAX_LENGTH}</span></div>
      <div className="flow-mode-toggle qr-template-row" role="group" aria-label="內容模板">
        {TEMPLATES.map((item) => (
          <button key={item.id} type="button" className={`button button-small ${template === item.id ? "button-blue" : "button-secondary"}`} aria-pressed={template === item.id} onClick={() => setTemplate(item.id)}>{item.label}</button>
        ))}
      </div>
      {template === "wifi" && (
        <div className="qr-template-fields">
          <label className="field-label" htmlFor="qr-wifi-ssid">Wi-Fi 名稱（SSID）<input id="qr-wifi-ssid" className="key-input" value={wifi.ssid} onChange={(event) => applyWifi({ ...wifi, ssid: event.target.value })} placeholder="例如 Home-WiFi" /></label>
          <label className="field-label" htmlFor="qr-wifi-auth">加密方式
            <select id="qr-wifi-auth" className="key-input" value={wifi.auth} onChange={(event) => applyWifi({ ...wifi, auth: event.target.value as WifiAuth })}>
              <option value="WPA">WPA／WPA2（最常見）</option>
              <option value="WEP">WEP（舊式）</option>
              <option value="nopass">開放網路（無密碼）</option>
            </select>
          </label>
          {wifi.auth !== "nopass" && <label className="field-label" htmlFor="qr-wifi-pass">密碼<input id="qr-wifi-pass" className="key-input" value={wifi.password} onChange={(event) => applyWifi({ ...wifi, password: event.target.value })} placeholder="Wi-Fi 密碼" /></label>}
          <p className="key-note">手機掃描即可直接加入這個 Wi-Fi，適合店面或民宿張貼。密碼只用來產生圖片，不會上傳。</p>
        </div>
      )}
      {template === "vcard" && (
        <div className="qr-template-fields">
          <label className="field-label" htmlFor="qr-vc-name">姓名（必填）<input id="qr-vc-name" className="key-input" value={vcard.name} onChange={(event) => applyVcard({ ...vcard, name: event.target.value })} placeholder="王小明" /></label>
          <label className="field-label" htmlFor="qr-vc-phone">電話<input id="qr-vc-phone" className="key-input" value={vcard.phone} onChange={(event) => applyVcard({ ...vcard, phone: event.target.value })} placeholder="0912-345-678" /></label>
          <label className="field-label" htmlFor="qr-vc-email">Email<input id="qr-vc-email" className="key-input" value={vcard.email} onChange={(event) => applyVcard({ ...vcard, email: event.target.value })} placeholder="name@example.com" /></label>
          <label className="field-label" htmlFor="qr-vc-org">公司／單位<input id="qr-vc-org" className="key-input" value={vcard.org} onChange={(event) => applyVcard({ ...vcard, org: event.target.value })} placeholder="選填" /></label>
          <label className="field-label" htmlFor="qr-vc-url">網站<input id="qr-vc-url" className="key-input" value={vcard.url} onChange={(event) => applyVcard({ ...vcard, url: event.target.value })} placeholder="選填" /></label>
          <p className="key-note">掃描後可直接存入通訊錄（vCard 3.0 格式）。</p>
        </div>
      )}
      {template === "sms" && (
        <div className="qr-template-fields">
          <label className="field-label" htmlFor="qr-sms-phone">收件號碼<input id="qr-sms-phone" className="key-input" value={sms.phone} onChange={(event) => applySms({ ...sms, phone: event.target.value })} placeholder="0912345678" /></label>
          <label className="field-label" htmlFor="qr-sms-message">簡訊內容<input id="qr-sms-message" className="key-input" value={sms.message} onChange={(event) => applySms({ ...sms, message: event.target.value })} placeholder="您好，我想詢問…" /></label>
          <p className="key-note">掃描後開啟簡訊 App 並帶入號碼與內容，適合活動報名或客服。</p>
        </div>
      )}
      <label className="field-label" htmlFor="qr-text">{template === "free" ? "網址或文字" : "產生的內容（可切回自由輸入手動修改）"}
        <textarea id="qr-text" className="participant-input qr-input" maxLength={QR_MAX_LENGTH} value={text} readOnly={template !== "free"} onChange={(event) => { setTemplate("free"); setText(event.target.value); }} placeholder="https://example.com 或任何文字" />
      </label>
      <div className="qr-option-grid">
        <label className="field-label" htmlFor="qr-dark">前景色
          <span className="qr-color-row"><input id="qr-dark" type="color" value={dark} onChange={(event) => setDark(event.target.value)} /><code>{dark}</code></span>
        </label>
        <label className="field-label" htmlFor="qr-light">背景色
          <span className="qr-color-row"><input id="qr-light" type="color" value={light} onChange={(event) => setLight(event.target.value)} /><code>{light}</code></span>
        </label>
        <label className="field-label" htmlFor="qr-level">容錯等級
          <select id="qr-level" className="key-input" value={level} onChange={(event) => setLevel(event.target.value as QrErrorLevel)}>
            <option value="L">L — 7%（內容可最多）</option>
            <option value="M">M — 15%（一般用途）</option>
            <option value="Q">Q — 25%</option>
            <option value="H">H — 30%（髒污環境）</option>
          </select>
        </label>
        <label className="field-label" htmlFor="qr-size">PNG 尺寸
          <select id="qr-size" className="key-input" value={size} onChange={(event) => setSize(Number(event.target.value))}>
            {SIZES.map((option) => <option key={option} value={option}>{option} px</option>)}
          </select>
        </label>
        <label className="field-label" htmlFor="qr-logo">中央 logo（選用）
          <span className="qr-logo-row">
            <input id="qr-logo" className="file-input" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              if (file.size > 2 * 1024 * 1024) { setError("logo 請小於 2 MB"); return; }
              const reader = new FileReader();
              reader.onload = () => setLogo(typeof reader.result === "string" ? reader.result : "");
              reader.readAsDataURL(file);
            }} />
            <button className="button button-small button-secondary" type="button" onClick={() => document.getElementById("qr-logo")?.click()}>{logo ? "更換 logo" : "選擇圖片"}</button>
            {logo && <button className="button button-small button-secondary" type="button" onClick={() => setLogo("")}>移除</button>}
          </span>
        </label>
      </div>
      {logo && <p className="key-note">已加上 logo：容錯等級自動使用 H（30%）確保可掃描；列印前請實際掃一次。</p>}
      {warning && <p className="error-message" role="alert">{warning}</p>}
      {error && <p className="error-message" role="alert">{error}</p>}
      <p className="key-note">全部在瀏覽器本機產生，內容不會上傳；列印或深色背景建議容錯 M 以上。</p>
    </div>
    <div className="panel panel-tinted">
      <div className="panel-header"><h2>預覽</h2><span className="panel-meta">即時更新</span></div>
      {dataUrl
        ? <>
            <div className="qr-preview" style={{ background: light }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 本機 data URL 預覽 */}
              <img src={dataUrl} alt="QR Code 預覽" />
            </div>
            <div className="result-actions">
              <button className="button button-small button-blue" type="button" onClick={downloadPng}>下載 PNG</button>
              <button className="button button-small button-secondary" type="button" onClick={downloadSvg}>下載 SVG</button>
              <button className="button button-small button-secondary" type="button" onClick={copyPng}>{copied ? "已複製 ✓" : "複製圖片"}</button>
            </div>
          </>
        : <div className="result-stage"><div className="result-empty"><strong>輸入內容就會出現</strong>QR Code 會即時產生，可下載 PNG、SVG 或直接複製。</div></div>}
    </div>
  </section>;
}
