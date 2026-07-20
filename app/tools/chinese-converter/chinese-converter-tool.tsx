"use client";

import { useEffect, useRef, useState } from "react";
import { textStats } from "@/lib/text-cleaner";

const STORAGE_KEY = "toolverse:chinese-converter:v1";

type Direction = "s2t" | "t2s";

type ConverterModule = typeof import("opencc-js");

let openccPromise: Promise<ConverterModule> | null = null;
function loadOpencc() {
  openccPromise ??= import("opencc-js");
  return openccPromise;
}

function sanitizeStoredState(value: unknown) {
  const data = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return {
    direction: data.direction === "t2s" ? ("t2s" as Direction) : ("s2t" as Direction),
    taiwanPhrases: data.taiwanPhrases !== false,
  };
}

export function ChineseConverterTool() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [direction, setDirection] = useState<Direction>("s2t");
  const [taiwanPhrases, setTaiwanPhrases] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const convertSeq = useRef(0);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = sanitizeStoredState(JSON.parse(saved));
        // 還原此裝置的偏好需要一次性的 client hydration。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDirection(data.direction); setTaiwanPhrases(data.taiwanPhrases);
      }
    } catch { localStorage.removeItem(STORAGE_KEY); }
     
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify({ direction, taiwanPhrases }));
  }, [hydrated, direction, taiwanPhrases]);

  useEffect(() => {
    if (!hydrated) return;
    const sequence = ++convertSeq.current;
    const timer = setTimeout(() => {
      if (input.trim() === "") { setOutput(""); setError(""); setLoading(false); return; }
      void (async () => {
        try {
          setLoading(true);
          const OpenCC = await loadOpencc();
          const converter = direction === "s2t"
            ? OpenCC.Converter({ from: "cn", to: taiwanPhrases ? "twp" : "tw" })
            : OpenCC.Converter({ from: taiwanPhrases ? "twp" : "tw", to: "cn" });
          const result = converter(input);
          if (convertSeq.current !== sequence) return;
          setOutput(result);
          setError("");
        } catch {
          if (convertSeq.current !== sequence) return;
          setError("字典載入失敗，請檢查網路後重試");
        } finally {
          if (convertSeq.current === sequence) setLoading(false);
        }
      })();
    }, 250);
    return () => clearTimeout(timer);
  }, [hydrated, input, direction, taiwanPhrases]);

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      setError("無法複製到剪貼簿，請手動選取結果複製");
    }
  }

  function downloadOutput() {
    const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "繁簡轉換結果.txt";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function swap() {
    setDirection((previous) => (previous === "s2t" ? "t2s" : "s2t"));
    if (output) { setInput(output); setOutput(input); }
  }

  const inputCount = textStats(input).characters;
  const outputCount = textStats(output).characters;

  return <section className="workspace text-cleaner-workspace page-shell" aria-label="繁簡轉換工具">
    <div className="panel">
      <div className="panel-header"><h2>{direction === "s2t" ? "簡體輸入" : "繁體輸入"}</h2><span className="panel-meta">{inputCount} 字</span></div>
      <label className="sr-only" htmlFor="cc-input">要轉換的文字</label>
      <textarea id="cc-input" className="participant-input cleaner-input" value={input} onChange={(event) => setInput(event.target.value)} placeholder={direction === "s2t" ? "贴上简体中文，会即时转成繁体…" : "貼上繁體中文，會即時轉成簡體…"} />
      <div className="flow-mode-toggle" role="radiogroup" aria-label="轉換方向">
        <button type="button" className={`button button-small ${direction === "s2t" ? "button-blue" : "button-secondary"}`} aria-pressed={direction === "s2t"} onClick={() => setDirection("s2t")}>簡 → 繁</button>
        <button type="button" className={`button button-small ${direction === "t2s" ? "button-blue" : "button-secondary"}`} aria-pressed={direction === "t2s"} onClick={() => setDirection("t2s")}>繁 → 簡</button>
        <button type="button" className="button button-small button-secondary" onClick={swap} title="交換方向並帶入結果">⇄ 交換</button>
      </div>
      <label className="check-row timer-sound"><input type="checkbox" checked={taiwanPhrases} onChange={(event) => setTaiwanPhrases(event.target.checked)} />台灣用詞轉換（軟件→軟體、信息→資訊）</label>
      <p className="key-note">使用 OpenCC 字典在瀏覽器本機轉換，內容不上傳；首次使用會載入字典檔。</p>
    </div>
    <div className="panel panel-tinted">
      <div className="panel-header"><h2>{direction === "s2t" ? "繁體結果" : "簡體結果"}</h2><span className="panel-meta">{loading ? "轉換中…" : `${outputCount} 字`}</span></div>
      <label className="sr-only" htmlFor="cc-output">轉換後的文字</label>
      <textarea id="cc-output" className="participant-input cleaner-input" value={output} readOnly placeholder="結果會即時出現在這裡" />
      <div className="result-actions">
        <button className="button button-small button-blue" type="button" onClick={copyOutput} disabled={output === ""}>{copied ? "已複製 ✓" : "複製結果"}</button>
        <button className="button button-small button-secondary" type="button" onClick={downloadOutput} disabled={output === ""}>下載 .txt</button>
        <button className="button button-small button-secondary" type="button" onClick={() => { setInput(""); setOutput(""); setError(""); }} disabled={input === ""}>清空</button>
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}
    </div>
  </section>;
}
