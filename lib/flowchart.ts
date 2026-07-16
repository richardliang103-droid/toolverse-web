export type FlowNodeShape = "process" | "decision" | "start" | "end" | "database" | "document";

export type FlowNode = {
  id: string;
  label: string;
  shape: FlowNodeShape;
};

export type FlowEdge = {
  source: string;
  target: string;
  label: string;
};

export type FlowGraph = {
  title: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
};

export const FLOWCHART_SYSTEM_PROMPT =
  "你是流程分析師。把使用者的中文需求轉成清楚、精簡、可執行的流程圖資料。節點 ID 必須是短英文或數字且不重複；每條連線的 source 與 target 必須引用存在的節點 ID；判斷節點要有清楚的分支標籤；不要加入使用者未提及的敏感資料；最多 18 個節點。";

/**
 * JSON schema for the flowchart graph, written using only the schema keywords
 * that Gemini's structured-output mode reliably supports (no
 * `additionalProperties`, which OpenAI's stricter `json_schema` mode needs
 * but Gemini does not accept in the same way).
 */
export const FLOWCHART_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    nodes: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
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

const SHAPES = new Set<FlowNodeShape>(["process", "decision", "start", "end", "database", "document"]);

function cleanText(value: unknown, fallback: string, maxLength = 80) {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, maxLength);
}

// Mermaid's flowchart grammar treats these as reserved keywords (block
// terminators, direction/style directives, etc.) even when they're used as a
// node id — e.g. `end(["Done"])` fails to parse because `end` closes a
// subgraph. Node ids that collide with one of these must be renamed, or
// mermaid.parse() throws and the whole diagram silently fails to render.
const MERMAID_RESERVED_IDS = new Set([
  "graph", "flowchart", "subgraph", "end", "start", "class", "classDef",
  "click", "style", "linkStyle", "direction", "default",
]);

function cleanId(value: unknown, index: number) {
  const base = typeof value === "string" ? value : `step_${index + 1}`;
  const cleaned = base.normalize("NFKD").replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "");
  const safe = /^[a-zA-Z]/.test(cleaned) ? cleaned.slice(0, 36) : `step_${cleaned || index + 1}`.slice(0, 36);
  return MERMAID_RESERVED_IDS.has(safe) ? `${safe}_node` : safe;
}

export function normalizeGraph(input: unknown): { graph: FlowGraph; repairs: string[] } {
  if (!input || typeof input !== "object") throw new Error("AI 沒有回傳可用的流程圖結構");
  const source = input as Record<string, unknown>;
  const rawNodes = Array.isArray(source.nodes) ? source.nodes.slice(0, 24) : [];
  const rawEdges = Array.isArray(source.edges) ? source.edges.slice(0, 48) : [];
  if (!rawNodes.length) throw new Error("流程圖至少需要一個節點");

  const repairs: string[] = [];
  const usedIds = new Set<string>();
  const idMap = new Map<string, string>();
  const nodes = rawNodes.map((raw, index) => {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const originalId = typeof item.id === "string" ? item.id : `step_${index + 1}`;
    let id = cleanId(originalId, index);
    const base = id;
    let suffix = 2;
    while (usedIds.has(id)) id = `${base}_${suffix++}`.slice(0, 42);
    if (id !== originalId) repairs.push(`已整理節點 ID「${originalId}」`);
    usedIds.add(id);
    if (!idMap.has(originalId)) idMap.set(originalId, id);
    const shape = SHAPES.has(item.shape as FlowNodeShape) ? item.shape as FlowNodeShape : "process";
    if (shape !== item.shape) repairs.push(`已修正「${cleanText(item.label, id)}」的節點類型`);
    return { id, label: cleanText(item.label, `步驟 ${index + 1}`), shape };
  });

  const seenEdges = new Set<string>();
  const edges: FlowEdge[] = [];
  for (const raw of rawEdges) {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const sourceId = idMap.get(String(item.source ?? ""));
    const targetId = idMap.get(String(item.target ?? ""));
    if (!sourceId || !targetId || sourceId === targetId) {
      repairs.push("已移除無效或自我連接的線段");
      continue;
    }
    const key = `${sourceId}:${targetId}:${String(item.label ?? "")}`;
    if (seenEdges.has(key)) {
      repairs.push("已移除重複線段");
      continue;
    }
    seenEdges.add(key);
    edges.push({ source: sourceId, target: targetId, label: cleanText(item.label, "", 48) });
  }

  if (!edges.length && nodes.length > 1) {
    for (let index = 0; index < nodes.length - 1; index += 1) {
      edges.push({ source: nodes[index].id, target: nodes[index + 1].id, label: "" });
    }
    repairs.push("AI 未提供有效連線，已依節點順序自動補上");
  }

  return {
    graph: { title: cleanText(source.title, "AI 流程圖", 60), nodes, edges },
    repairs: [...new Set(repairs)],
  };
}

function escapeMermaid(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function nodeDefinition(node: FlowNode) {
  const label = `"${escapeMermaid(node.label)}"`;
  if (node.shape === "decision") return `${node.id}{${label}}`;
  if (node.shape === "start" || node.shape === "end") return `${node.id}([${label}])`;
  if (node.shape === "database") return `${node.id}[(${label})]`;
  if (node.shape === "document") return `${node.id}[/${label}/]`;
  return `${node.id}[${label}]`;
}

export function generateMermaid(graph: FlowGraph, direction: "TD" | "LR") {
  const lines = [`flowchart ${direction}`];
  for (const node of graph.nodes) lines.push(`  ${nodeDefinition(node)}`);
  for (const edge of graph.edges) {
    const label = edge.label ? `|"${escapeMermaid(edge.label)}"|` : "";
    lines.push(`  ${edge.source} -->${label} ${edge.target}`);
  }
  lines.push("  classDef default fill:#fffdf7,stroke:#101628,stroke-width:1.5px,color:#101628;");
  lines.push("  classDef decision fill:#ffd9ce,stroke:#101628,stroke-width:1.5px,color:#101628;");
  const decisions = graph.nodes.filter((node) => node.shape === "decision").map((node) => node.id);
  if (decisions.length) lines.push(`  class ${decisions.join(",")} decision;`);
  return lines.join("\n");
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function drawioStyle(shape: FlowNodeShape) {
  const base = "whiteSpace=wrap;html=1;strokeColor=#101628;fontColor=#101628;fontSize=15;strokeWidth=2;";
  if (shape === "decision") return `${base}rhombus;fillColor=#ffd9ce;`;
  if (shape === "start" || shape === "end") return `${base}rounded=1;arcSize=50;fillColor=#b8ebd0;`;
  if (shape === "database") return `${base}shape=cylinder3;boundedLbl=1;backgroundOutline=1;fillColor=#dfe5ff;`;
  if (shape === "document") return `${base}shape=document;boundedLbl=1;fillColor=#fffdf7;`;
  return `${base}rounded=1;arcSize=12;fillColor=#fffdf7;`;
}

export function generateDrawioXml(graph: FlowGraph, direction: "TD" | "LR") {
  const nodeCells = graph.nodes.map((node, index) => {
    const column = direction === "LR" ? index : index % 3;
    const row = direction === "LR" ? index % 3 : Math.floor(index / 3);
    const x = 60 + column * (direction === "LR" ? 230 : 250);
    const y = 60 + row * (direction === "LR" ? 150 : 150);
    const width = node.shape === "decision" ? 150 : 180;
    const height = node.shape === "decision" ? 100 : 76;
    return `<mxCell id="n_${escapeXml(node.id)}" value="${escapeXml(node.label)}" style="${drawioStyle(node.shape)}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry"/></mxCell>`;
  }).join("");
  const edgeCells = graph.edges.map((edge, index) => `<mxCell id="e_${index + 1}" value="${escapeXml(edge.label)}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#3557ff;strokeWidth=2;endArrow=block;endFill=1;" edge="1" parent="1" source="n_${escapeXml(edge.source)}" target="n_${escapeXml(edge.target)}"><mxGeometry relative="1" as="geometry"/></mxCell>`).join("");
  const modified = new Date().toISOString();
  return `<mxfile host="ToolVerse" modified="${modified}" agent="ToolVerse AI Flowchart" version="30.1.13"><diagram id="toolverse-flow" name="${escapeXml(graph.title)}"><mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${nodeCells}${edgeCells}</root></mxGraphModel></diagram></mxfile>`;
}

export const SAMPLE_GRAPH: FlowGraph = {
  title: "請假申請流程",
  // Node ids avoid mermaid's reserved words (e.g. bare `start`/`end`) — see
  // MERMAID_RESERVED_IDS above; those break mermaid.parse() if used as-is.
  nodes: [
    { id: "start_node", label: "提出請假申請", shape: "start" },
    { id: "check", label: "主管審核", shape: "decision" },
    { id: "approve", label: "通知申請人並登記", shape: "process" },
    { id: "revise", label: "補充資料後重新送出", shape: "process" },
    { id: "end_node", label: "流程完成", shape: "end" },
  ],
  edges: [
    { source: "start_node", target: "check", label: "" },
    { source: "check", target: "approve", label: "通過" },
    { source: "check", target: "revise", label: "退回" },
    { source: "revise", target: "check", label: "重新送出" },
    { source: "approve", target: "end_node", label: "" },
  ],
};
