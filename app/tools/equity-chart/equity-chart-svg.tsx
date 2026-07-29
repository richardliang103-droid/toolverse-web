"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { EQUITY_BOX_HEIGHT, EQUITY_BOX_WIDTH, ENTITY_STATUS_LABELS } from "@/lib/equity-chart";
import type { EntityKind, EntityStatus, EquityChart, EquityLayout, EquityLayoutNode } from "@/lib/equity-chart";

const INK = "#101628";
const PAPER = "#f5f1e8";
const MUTED = "#656a76";
const ALERT = "#c94a3a";

const KIND_COLORS: Record<EntityKind, { soft: string; strong: string }> = {
  person: { soft: "#e4ecf3", strong: "#5f83a8" }, // 縹
  domestic: { soft: "#ebf1e2", strong: "#7d9a63" }, // 松葉
  offshore: { soft: "#f9e9ec", strong: "#cf7f8d" }, // 鴇
};
const SUBJECT_COLOR = { soft: "#ece7f5", strong: "#9b8bbf" }; // 藤

function nonActiveStatus(status: EntityStatus) {
  return status !== "active";
}

export type EquityChartSvgHandle = { exportSvg: () => string | null };

type Props = {
  chart: EquityChart;
  layout: EquityLayout;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

/** 從節點底邊中點到子節點頂邊中點的直角折線，跟甘特圖依賴線同一套視覺語言。 */
function elbowPath(from: EquityLayoutNode, to: EquityLayoutNode) {
  const startX = from.x + EQUITY_BOX_WIDTH / 2;
  const startY = from.y + EQUITY_BOX_HEIGHT;
  const endX = to.x + EQUITY_BOX_WIDTH / 2;
  const endY = to.y;
  const midY = startY + (endY - startY) / 2;
  if (Math.abs(startX - endX) < 1) return `M${startX} ${startY} L${endX} ${endY}`;
  return `M${startX} ${startY} L${startX} ${midY} L${endX} ${midY} L${endX} ${endY}`;
}

/** 交叉持股／循環持股沒有固定的上下關係，畫成從右緣繞出去的虛線弧，跟主要階層線分開辨識。 */
function crossPath(from: EquityLayoutNode, to: EquityLayoutNode) {
  const startX = from.x + EQUITY_BOX_WIDTH;
  const startY = from.y + EQUITY_BOX_HEIGHT / 2;
  const endX = to.x + EQUITY_BOX_WIDTH;
  const endY = to.y + EQUITY_BOX_HEIGHT / 2;
  const bulge = Math.max(60, Math.abs(endY - startY) / 2);
  return `M${startX} ${startY} C${startX + bulge} ${startY} ${endX + bulge} ${endY} ${endX} ${endY}`;
}

export const EquityChartSvg = forwardRef<EquityChartSvgHandle, Props>(function EquityChartSvg(
  { chart, layout, selectedId, onSelect },
  ref,
) {
  const svgRef = useRef<SVGSVGElement>(null);

  useImperativeHandle(ref, () => ({
    exportSvg() {
      return svgRef.current ? svgRef.current.outerHTML : null;
    },
  }));

  const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      fontFamily='Inter, "Noto Sans TC", sans-serif'
      role="img"
      aria-label={`${chart.title} 股權架構圖`}
    >
      <rect x={0} y={0} width={layout.width} height={layout.height} fill="#fffdf7" />
      {layout.edges.filter((edge) => edge.kind === "tree").map((edge) => {
        const from = nodeById.get(edge.fromId);
        const to = nodeById.get(edge.toId);
        if (!from || !to) return null;
        const midX = (from.x + to.x) / 2 + EQUITY_BOX_WIDTH / 2;
        const midY = from.y + EQUITY_BOX_HEIGHT + (to.y - from.y - EQUITY_BOX_HEIGHT) / 2;
        return (
          <g key={edge.id}>
            <path d={elbowPath(from, to)} fill="none" stroke={MUTED} strokeWidth={1.25} />
            <rect x={midX - 20} y={midY - 8} width={40} height={16} rx={8} fill={PAPER} />
            <text x={midX} y={midY + 4} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={INK}>{formatPercent(edge.holding.percentage)}</text>
          </g>
        );
      })}
      {layout.edges.filter((edge) => edge.kind === "cross").map((edge) => {
        const from = nodeById.get(edge.fromId);
        const to = nodeById.get(edge.toId);
        if (!from || !to) return null;
        return (
          <g key={edge.id}>
            <path d={crossPath(from, to)} fill="none" stroke={ALERT} strokeWidth={1.25} strokeDasharray="5 4" />
            <text x={Math.max(from.x, to.x) + EQUITY_BOX_WIDTH + 6} y={(from.y + to.y) / 2 + EQUITY_BOX_HEIGHT / 2 + 4} fontSize={10} fill={ALERT}>{`交叉持股 ${formatPercent(edge.holding.percentage)}`}</text>
          </g>
        );
      })}
      {layout.nodes.map((node) => {
        const entity = node.entity;
        const colors = entity.isSubject ? SUBJECT_COLOR : KIND_COLORS[entity.kind];
        const selected = node.id === selectedId;
        const dashed = entity.kind === "offshore";
        const flagged = nonActiveStatus(entity.status);
        return (
          <g
            key={node.id}
            role="button"
            tabIndex={0}
            aria-label={`${entity.name}${entity.isSubject ? "，受查公司" : ""}`}
            style={{ cursor: "pointer", outline: "none" }}
            onClick={() => onSelect(node.id)}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(node.id); } }}
          >
            <rect
              x={node.x}
              y={node.y}
              width={EQUITY_BOX_WIDTH}
              height={EQUITY_BOX_HEIGHT}
              rx={entity.kind === "person" ? EQUITY_BOX_HEIGHT / 2 : 8}
              fill={colors.soft}
              stroke={selected ? colors.strong : INK}
              strokeWidth={selected ? 2.4 : entity.isSubject ? 2 : 1.25}
              strokeDasharray={dashed ? "6 4" : undefined}
            />
            <text x={node.x + EQUITY_BOX_WIDTH / 2} y={node.y + 25} textAnchor="middle" fontSize={13} fontWeight={700} fill={INK}>{truncate(entity.name, 11)}</text>
            <text x={node.x + EQUITY_BOX_WIDTH / 2} y={node.y + 42} textAnchor="middle" fontSize={10.5} fill={MUTED}>{subtitle(entity)}</text>
            {flagged && (
              <g>
                <rect x={node.x + EQUITY_BOX_WIDTH - 54} y={node.y - 11} width={54} height={18} rx={9} fill={ALERT} />
                <text x={node.x + EQUITY_BOX_WIDTH - 27} y={node.y + 2} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#fff">{ENTITY_STATUS_LABELS[entity.status]}</text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
});

function formatPercent(value: number) {
  return `${Number.isInteger(value) ? value : Math.round(value * 10) / 10}%`;
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function subtitle(entity: { isSubject: boolean; kind: EntityKind; region?: string; note?: string }) {
  if (entity.isSubject) return "受查公司";
  if (entity.kind === "offshore") return entity.region ? `境外・${entity.region}` : "境外法人";
  if (entity.kind === "person") return entity.note ? truncate(entity.note, 12) : "自然人";
  return entity.note ? truncate(entity.note, 12) : "國內法人";
}
