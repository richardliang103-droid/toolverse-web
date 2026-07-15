"use client";

import { useState } from "react";
import { SAMPLE_GRAPH, generateDrawioXml, generateMermaid, normalizeGraph } from "@/lib/flowchart";
import type { FlowGraph } from "@/lib/flowchart";

type ApiOutput = {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
  error?: { message?: string };
};

const GRAPH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    nodes: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          shape: { type: "string", enum: ["process", "decision", "start", "end", "database", "document"] },
        },
        required: ["id", "label", "shape"],
      },
    },
    edges: {
      type: "array",
      maxItems: 48,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          source: { type: "string" },
          target: { type: "string" },
          label: { type: "string" },
        },
        required: ["source", "target", "label"],
      },
    },
  },
  required: ["title", "nodes", "edges"],
} as const;

function extractOutput(data: ApiOutput) {
  if (data.output_text) return data.output_text;
  for (const item of data.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "refusal") throw new Error(content.refusal || "AI 無法處理這項需求");
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new Error(data.error?.message || "AI 沒有回傳可用結果");
}

function safeFilename(title: string) {
  return title.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").slice(0, 48) || "toolverse-flowchart";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AiFlowchartTool() {
  const [prompt, setPrompt] = useState("建立一個請假申請流程：員工送出申請，主管審核；通過後通知員工並登記，退回則補充資料後重新送出。");
  const [apiKey, setApiKey] = useState("");
  const [direction, setDirection] = useState<"TD" | "LR">("TD");
  const [graph, setGraph] = useState<FlowGraph | null>(null);
  const [mermaidCode, setMermaidCode] = useState("");
  const [drawioXml, setDrawioXml] = useState("");
  const [svg, setSvg] = useState("");
  const [repairs, setRepairs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function renderGraph(nextGraph: FlowGraph, nextRepairs: string[] = [], nextDirection = direction) {
    const code = generateMermaid(nextGraph, nextDirection);
    const xml = generateDrawioXml(nextGraph, nextDirection);
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", flowchart: { htmlLabels: false, curve: "basis" }, themeVariables: { primaryColor: "#fffdf7", primaryTextColor: "#101628", primaryBorderColor: "#101628", lineColor: "#3557ff", secondaryColor: "#ffd9ce", tertiaryColor: "#dfe5ff", fontFamily: "Arial, sans-serif" } });
    await mermaid.parse(code);
    const rendered = await mermaid.render(`toolverse-flow-${Date.now()}`, code);
    setGraph(nextGraph);
    setMermaidCode(code);
    setDrawioXml(xml);
    setSvg(rendered.svg);
    setRepairs(nextRepairs);
  }

  function changeDirection(nextDirection: "TD" | "LR") {
    setDirection(nextDirection);
    if (graph) void renderGraph(graph, repairs, nextDirection).catch(() => setError("重新排列流程圖時發生錯誤"));
  }

  async function generate() {
    if (prompt.trim().length < 10) { setError("請多描述幾個步驟、判斷或角色"); return; }
    if (apiKey.trim().length < 20) { setError("請輸入有效的 OpenAI API 金鑰；金鑰只會暫存在這個頁面"); return; }
    setLoading(true); setError(""); setCopied(false);
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey.trim()}` },
        body: JSON.stringify({
          model: "gpt-5.4-mini",
          store: false,
          reasoning: { effort: "low" },
          input: [
            { role: "developer", content: "你是流程分析師。把使用者的中文需求轉成清楚、精簡、可執行的流程圖資料。節點 ID 必須是短英文或數字且不重複；每條連線的 source 與 target 必須引用存在的節點 ID；判斷節點要有清楚的分支標籤；不要加入使用者未提及的敏感資料；最多 18 個節點。" },
            { role: "user", content: prompt.trim().slice(0, 3000) },
          ],
          text: { format: { type: "json_schema", name: "toolverse_flowchart", strict: true, schema: GRAPH_SCHEMA } },
        }),
      });
      const data = await response.json() as ApiOutput;
      if (!response.ok) throw new Error(data.error?.message || `AI 服務暫時無法使用（${response.status}）`);
      const raw = JSON.parse(extractOutput(data)) as unknown;
      const normalized = normalizeGraph(raw);
      await renderGraph(normalized.graph, normalized.repairs);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "流程圖產生失敗";
      setError(message.includes("Failed to fetch") ? "無法直接連上 OpenAI，請檢查網路或 API 金鑰權限" : message);
    } finally {
      setLoading(false);
    }
  }

  async function loadSample() {
    setError(""); setCopied(false);
    await renderGraph(SAMPLE_GRAPH, ["範例已通過節點與連線驗證"]);
  }

  async function copyMermaid() {
    await navigator.clipboard.writeText(mermaidCode);
    setCopied(true);
  }

  function downloadSvg() {
    if (!svg || !graph) return;
    downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${safeFilename(graph.title)}.svg`);
  }

  function downloadDrawio() {
    if (!drawioXml || !graph) return;
    downloadBlob(new Blob([drawioXml], { type: "application/xml;charset=utf-8" }), `${safeFilename(graph.title)}.drawio`);
  }

  function downloadPng() {
    if (!svg || !graph) return;
    const image = new Image();
    const source = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    image.onload = () => {
      const viewBox = svg.match(/viewBox=["']([\d.\s-]+)["']/)?.[1].trim().split(/\s+/).map(Number);
      const ratio = viewBox?.length === 4 && viewBox[2] > 0 ? viewBox[3] / viewBox[2] : 2 / 3;
      const width = Math.max(900, image.naturalWidth || 900);
      const height = Math.max(360, Math.round(width * ratio));
      const scale = Math.min(2, 2400 / width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(scale, scale); context.fillStyle = "#fffdf7"; context.fillRect(0, 0, width, height); context.drawImage(image, 0, 0, width, height);
      canvas.toBlob((blob) => { if (blob) downloadBlob(blob, `${safeFilename(graph.title)}.png`); }, "image/png");
      URL.revokeObjectURL(source);
    };
    image.onerror = () => { URL.revokeObjectURL(source); setError("PNG 產生失敗，請改下載 SVG"); };
    image.src = source;
  }

  function openInDrawio() {
    if (!drawioXml) return;
    const create = encodeURIComponent(JSON.stringify({ type: "xml", data: drawioXml }));
    window.open(`https://app.diagrams.net/?splash=0&mode=device#create=${create}`, "_blank", "noopener,noreferrer");
  }

  return <section className="flowchart-workspace page-shell" aria-label="AI 流程圖工具">
    <div className="panel flowchart-controls">
      <div className="panel-header"><h2>描述你的流程</h2><span className="panel-meta">中文即可</span></div>
      <label className="field-label" htmlFor="flow-prompt">流程需求</label>
      <textarea id="flow-prompt" className="flow-prompt" value={prompt} maxLength={3000} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：建立顧客退貨流程，包含訂單確認、商品檢查、退款或換貨…" />
      <div className="flow-options">
        <label className="field-label" htmlFor="flow-direction">排列方向<select id="flow-direction" value={direction} onChange={(event) => changeDirection(event.target.value as "TD" | "LR")}><option value="TD">由上到下</option><option value="LR">由左到右</option></select></label>
      </div>
      <label className="field-label" htmlFor="openai-key">OpenAI API 金鑰<input id="openai-key" className="key-input" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" spellCheck={false} placeholder="sk-…" /></label>
      <p className="key-note">只暫存在目前頁面，直接送往 OpenAI；ToolVerse 不會儲存金鑰。流程文字會交由 OpenAI 產生結構。</p>
      <div className="flow-generate-actions"><button className="button button-blue" type="button" onClick={generate} disabled={loading}>{loading ? "AI 正在整理流程…" : "用 AI 產生流程圖 ✦"}</button><button className="button button-secondary" type="button" onClick={loadSample} disabled={loading}>先看範例</button></div>
      {error && <p className="error-message" role="alert">{error}</p>}
      {graph && <div className="validation-card"><strong>✓ 結構驗證完成</strong><span>{graph.nodes.length} 個節點 · {graph.edges.length} 條連線</span>{repairs.length > 0 && <details><summary>{repairs.length} 項自動整理</summary><ul>{repairs.map((repair) => <li key={repair}>{repair}</li>)}</ul></details>}</div>}
    </div>
    <div className="panel panel-tinted flowchart-preview-panel">
      <div className="panel-header"><h2>{graph?.title ?? "流程圖預覽"}</h2><span className="panel-meta">Mermaid + draw.io</span></div>
      {loading ? <div className="flowchart-empty"><div className="processing-disc" /><strong>正在拆解步驟與判斷</strong><span>完成後會自動驗證並修正結構</span></div> : svg ? <div className="flowchart-canvas" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="flowchart-empty"><strong>從一句話開始</strong><span>產生後可預覽、複製 Mermaid，或匯出到 diagrams.net 繼續編輯。</span></div>}
      {svg && <><div className="export-toolbar"><button className="button button-small button-secondary" type="button" onClick={downloadPng}>下載 PNG</button><button className="button button-small button-secondary" type="button" onClick={downloadSvg}>下載 SVG</button><button className="button button-small button-secondary" type="button" onClick={downloadDrawio}>下載 .drawio</button><button className="button button-small button-coral" type="button" onClick={openInDrawio}>到 diagrams.net 編輯 ↗</button></div><details className="mermaid-code"><summary>查看 Mermaid 原始碼</summary><pre>{mermaidCode}</pre><button className="button button-small button-secondary" type="button" onClick={copyMermaid}>{copied ? "已複製 ✓" : "複製 Mermaid"}</button></details></>}
    </div>
  </section>;
}
