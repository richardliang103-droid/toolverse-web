"use client";

import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "toolverse:markdown-editor:v1";

const SAMPLE = "# 歡迎使用 Markdown 編輯器\n\n左邊寫、右邊即時預覽，內容自動存在你的瀏覽器。\n\n## 支援語法\n\n- **粗體**、*斜體*、`行內程式碼`\n- [連結](https://example.com)、清單、引用\n\n> 引用區塊長這樣\n\n```\n程式碼區塊\n```\n\n| 欄位 | 說明 |\n| --- | --- |\n| 表格 | 也支援 |\n";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type ToolbarAction = { label: string; title: string; prefix: string; suffix: string; block?: boolean };

const TOOLBAR: ToolbarAction[] = [
  { label: "B", title: "粗體", prefix: "**", suffix: "**" },
  { label: "I", title: "斜體", prefix: "*", suffix: "*" },
  { label: "H2", title: "標題", prefix: "## ", suffix: "", block: true },
  { label: "🔗", title: "連結", prefix: "[", suffix: "](https://)" },
  { label: "•", title: "清單", prefix: "- ", suffix: "", block: true },
  { label: "❝", title: "引用", prefix: "> ", suffix: "", block: true },
  { label: "‹›", title: "程式碼", prefix: "`", suffix: "`" },
];

export function MarkdownEditorTool() {
  const [text, setText] = useState(SAMPLE);
  const [html, setHtml] = useState("");
  const [copied, setCopied] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      // 還原上次的草稿需要一次性的 client hydration。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (typeof saved === "string" && saved.trim() !== "") setText(saved);
    } catch { localStorage.removeItem(STORAGE_KEY); }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, text);
  }, [hydrated, text]);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const { marked } = await import("marked");
        // 原始 HTML 一律跳脫呈現：預覽只渲染 Markdown 語法本身，杜絕 script 注入。
        marked.use({ renderer: { html: (token: { text: string }) => escapeHtml(token.text) } });
        const rendered = await marked.parse(text, { gfm: true, breaks: true });
        if (!cancelled) setHtml(rendered);
      })();
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [hydrated, text]);

  function applyAction(action: ToolbarAction) {
    const editor = editorRef.current;
    if (!editor) return;
    const { selectionStart, selectionEnd } = editor;
    const selected = text.slice(selectionStart, selectionEnd) || (action.block ? "" : "文字");
    const before = text.slice(0, selectionStart);
    const insertion = action.block && before !== "" && !before.endsWith("\n")
      ? `\n${action.prefix}${selected}${action.suffix}`
      : `${action.prefix}${selected}${action.suffix}`;
    const next = before + insertion + text.slice(selectionEnd);
    setText(next);
    requestAnimationFrame(() => {
      editor.focus();
      const cursor = selectionStart + insertion.length;
      editor.setSelectionRange(cursor, cursor);
    });
  }

  function downloadMarkdown() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "toolverse-筆記.md";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyHtml() {
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch { /* 複製失敗時保持原狀，使用者可改用下載 */ }
  }

  const characters = text.length;
  const lines = text === "" ? 0 : text.split("\n").length;

  return <section className="workspace markdown-workspace page-shell" aria-label="Markdown 編輯器">
    <div className="panel markdown-editor-panel">
      <div className="panel-header"><h2>編輯</h2><span className="panel-meta">{characters.toLocaleString()} 字 · {lines} 行 · 自動儲存</span></div>
      <div className="markdown-toolbar" role="toolbar" aria-label="格式工具列">
        {TOOLBAR.map((action) => (
          <button key={action.title} type="button" className="markdown-toolbar-button" title={action.title} aria-label={action.title} onClick={() => applyAction(action)}>{action.label}</button>
        ))}
      </div>
      <label className="sr-only" htmlFor="markdown-input">Markdown 內容</label>
      <textarea id="markdown-input" ref={editorRef} className="participant-input markdown-input" value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} placeholder="# 開始寫 Markdown…" />
      <div className="result-actions">
        <button className="button button-small button-blue" type="button" onClick={downloadMarkdown} disabled={text.trim() === ""}>下載 .md</button>
        <button className="button button-small button-secondary" type="button" onClick={copyHtml} disabled={html === ""}>{copied ? "已複製 ✓" : "複製 HTML"}</button>
        <button className="button button-small button-secondary" type="button" onClick={() => setText("")} disabled={text === ""}>清空</button>
      </div>
    </div>
    <div className="panel panel-tinted markdown-preview-panel">
      <div className="panel-header"><h2>預覽</h2><span className="panel-meta">即時渲染</span></div>
      {text.trim() === ""
        ? <div className="result-stage"><div className="result-empty"><strong>左邊開始寫</strong>支援 GFM：表格、程式碼區塊、清單與引用。</div></div>
        : <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  </section>;
}
