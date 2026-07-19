"use client";

import { useEffect, useMemo, useState } from "react";
import { CountUp } from "@/components/count-up";
import { DEFAULT_CLEANER_OPTIONS, cleanText, textStats } from "@/lib/text-cleaner";
import type { TextCleanerOptions } from "@/lib/text-cleaner";

const STORAGE_KEY = "toolverse:text-cleaner:v1";

function sanitizeOptions(value: unknown): TextCleanerOptions {
  const data = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return {
    trimLines: data.trimLines !== false,
    dropEmptyLines: data.dropEmptyLines === true,
    dedupeLines: data.dedupeLines === true,
    toHalfwidth: data.toHalfwidth === true,
    collapseSpaces: data.collapseSpaces === true,
    sort: data.sort === "asc" || data.sort === "desc" ? data.sort : "none",
    casing: data.casing === "upper" || data.casing === "lower" ? data.casing : "none",
  };
}

const TOGGLES: Array<{ key: keyof Pick<TextCleanerOptions, "trimLines" | "dropEmptyLines" | "dedupeLines" | "toHalfwidth" | "collapseSpaces">; label: string; hint: string }> = [
  { key: "trimLines", label: "去除每行首尾空白", hint: "含全形空白" },
  { key: "dropEmptyLines", label: "移除空白行", hint: "" },
  { key: "dedupeLines", label: "移除重複行", hint: "保留第一次出現" },
  { key: "toHalfwidth", label: "全形轉半形", hint: "英數與標點" },
  { key: "collapseSpaces", label: "壓縮連續空格", hint: "多個空格併成一個" },
];

export function TextCleanerTool() {
  const [input, setInput] = useState("");
  const [options, setOptions] = useState<TextCleanerOptions>(DEFAULT_CLEANER_OPTIONS);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        // 還原此裝置的偏好需要一次性的 client hydration。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setOptions(sanitizeOptions(JSON.parse(saved)));
      }
    } catch { localStorage.removeItem(STORAGE_KEY); }
     
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  }, [hydrated, options]);

  const output = useMemo(() => cleanText(input, options), [input, options]);
  const inputStats = useMemo(() => textStats(input), [input]);
  const outputStats = useMemo(() => textStats(output), [output]);

  function toggle(key: (typeof TOGGLES)[number]["key"]) {
    setOptions((previous) => ({ ...previous, [key]: !previous[key] }));
  }

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
    const url = URL.createObjectURL(new Blob([output], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "toolverse-cleaned.txt";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="workspace text-cleaner-workspace page-shell" aria-label="文字清理工具">
    <div className="panel">
      <div className="panel-header"><h2>原始文字</h2><span className="panel-meta"><CountUp value={inputStats.characters} /> 字 · <CountUp value={inputStats.lines} /> 行</span></div>
      <label className="sr-only" htmlFor="cleaner-input">要清理的文字</label>
      <textarea id="cleaner-input" className="participant-input cleaner-input" value={input} onChange={(event) => setInput(event.target.value)} placeholder={"貼上要整理的文字…\n\n常見用途：清理從 PDF 或網頁複製的內容、整理名單、去重複。"} />
      <div className="cleaner-toggles">
        {TOGGLES.map((item) => (
          <label key={item.key} className="check-row cleaner-toggle" title={item.hint || undefined}>
            <input type="checkbox" checked={options[item.key]} onChange={() => toggle(item.key)} />{item.label}
          </label>
        ))}
      </div>
      <div className="cleaner-selects">
        <label className="field-label" htmlFor="cleaner-sort">行排序
          <select id="cleaner-sort" className="key-input" value={options.sort} onChange={(event) => setOptions((previous) => ({ ...previous, sort: event.target.value as TextCleanerOptions["sort"] }))}>
            <option value="none">保持原順序</option>
            <option value="asc">A → Z（筆畫／字母）</option>
            <option value="desc">Z → A</option>
          </select>
        </label>
        <label className="field-label" htmlFor="cleaner-case">英文大小寫
          <select id="cleaner-case" className="key-input" value={options.casing} onChange={(event) => setOptions((previous) => ({ ...previous, casing: event.target.value as TextCleanerOptions["casing"] }))}>
            <option value="none">不變更</option>
            <option value="upper">全部大寫</option>
            <option value="lower">全部小寫</option>
          </select>
        </label>
      </div>
    </div>
    <div className="panel panel-tinted">
      <div className="panel-header"><h2>清理結果</h2><span className="panel-meta"><CountUp value={outputStats.characters} /> 字 · <CountUp value={outputStats.lines} /> 行 · <CountUp value={outputStats.uniqueLines} /> 不重複</span></div>
      <label className="sr-only" htmlFor="cleaner-output">清理後的文字</label>
      <textarea id="cleaner-output" className="participant-input cleaner-input" value={output} readOnly placeholder="結果會即時出現在這裡" />
      <div className="result-actions">
        <button className="button button-small button-blue" type="button" onClick={copyOutput} disabled={output === ""}>{copied ? "已複製 ✓" : "複製結果"}</button>
        <button className="button button-small button-secondary" type="button" onClick={downloadOutput} disabled={output === ""}>下載 .txt</button>
        <button className="button button-small button-secondary" type="button" onClick={() => { setInput(""); setError(""); }} disabled={input === ""}>清空</button>
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}
    </div>
  </section>;
}
