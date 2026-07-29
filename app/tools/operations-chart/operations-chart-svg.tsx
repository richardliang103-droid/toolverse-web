"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { PAYMENT_TERM_LABELS, PARTY_BOX_HEIGHT } from "@/lib/operations-chart";
import type { OperationsChart, OperationsLayout, OperationsLayoutParty } from "@/lib/operations-chart";

const INK = "#101628";
const MUTED = "#656a76";
const RELATED = "#ba7517";

const UPSTREAM_COLOR = { soft: "#ebf1e2", strong: "#7d9a63" }; // 松葉
const DOWNSTREAM_COLOR = { soft: "#f9e9ec", strong: "#cf7f8d" }; // 鴇
const SUBJECT_COLOR = { soft: "#ece7f5", strong: "#9b8bbf" }; // 藤

export type OperationsChartSvgHandle = { exportSvg: () => string | null };

type Props = { chart: OperationsChart; layout: OperationsLayout };

function partyPath(item: OperationsLayoutParty, subject: OperationsLayout["subject"], side: "upstream" | "downstream") {
  const partyCenterY = item.y + item.height / 2;
  const subjectCenterY = subject.y + subject.height / 2;
  if (side === "upstream") {
    const startX = item.x + item.width;
    const endX = subject.x;
    const midX = startX + (endX - startX) / 2;
    return `M${startX} ${partyCenterY} L${midX} ${partyCenterY} L${midX} ${subjectCenterY} L${endX} ${subjectCenterY}`;
  }
  const startX = subject.x + subject.width;
  const endX = item.x;
  const midX = startX + (endX - startX) / 2;
  return `M${startX} ${subjectCenterY} L${midX} ${subjectCenterY} L${midX} ${partyCenterY} L${endX} ${partyCenterY}`;
}

export const OperationsChartSvg = forwardRef<OperationsChartSvgHandle, Props>(function OperationsChartSvg(
  { chart, layout },
  ref,
) {
  const svgRef = useRef<SVGSVGElement>(null);

  useImperativeHandle(ref, () => ({
    exportSvg() {
      return svgRef.current ? svgRef.current.outerHTML : null;
    },
  }));

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      fontFamily='Inter, "Noto Sans TC", sans-serif'
      role="img"
      aria-label={`${chart.title} 營運架構圖`}
    >
      <defs>
        <marker id="operations-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L8 4 L0 8 z" fill={MUTED} />
        </marker>
      </defs>
      <rect x={0} y={0} width={layout.width} height={layout.height} fill="#fffdf7" />
      {layout.upstream.map((item) => (
        <path key={`edge-${item.party.id}`} d={partyPath(item, layout.subject, "upstream")} fill="none" stroke={MUTED} strokeWidth={1.25} markerEnd="url(#operations-arrow)" />
      ))}
      {layout.downstream.map((item) => (
        <path key={`edge-${item.party.id}`} d={partyPath(item, layout.subject, "downstream")} fill="none" stroke={MUTED} strokeWidth={1.25} markerEnd="url(#operations-arrow)" />
      ))}
      <rect x={layout.subject.x} y={layout.subject.y} width={layout.subject.width} height={layout.subject.height} rx={8} fill={SUBJECT_COLOR.soft} stroke={SUBJECT_COLOR.strong} strokeWidth={2} />
      <text x={layout.subject.x + layout.subject.width / 2} y={layout.subject.y + layout.subject.height / 2 - 4} textAnchor="middle" fontSize={13.5} fontWeight={700} fill={INK}>{truncate(chart.subjectName, 12)}</text>
      <text x={layout.subject.x + layout.subject.width / 2} y={layout.subject.y + layout.subject.height / 2 + 15} textAnchor="middle" fontSize={10} fill={MUTED}>{truncate(chart.businessModel || "受查公司", 16)}</text>
      {layout.upstream.map((item) => <PartyBox key={item.party.id} item={item} colors={UPSTREAM_COLOR} />)}
      {layout.downstream.map((item) => <PartyBox key={item.party.id} item={item} colors={DOWNSTREAM_COLOR} />)}
      <text x={MARGIN_X(layout, "upstream")} y={20} fontSize={11} fontWeight={700} fill={MUTED}>上游供應商</text>
      <text x={MARGIN_X(layout, "downstream")} y={20} fontSize={11} fontWeight={700} fill={MUTED}>下游客戶</text>
    </svg>
  );
});

function MARGIN_X(layout: OperationsLayout, side: "upstream" | "downstream") {
  const list = side === "upstream" ? layout.upstream : layout.downstream;
  return list[0]?.x ?? (side === "upstream" ? 40 : layout.width - 200);
}

function PartyBox({ item, colors }: { item: OperationsLayoutParty; colors: { soft: string; strong: string } }) {
  const { party } = item;
  return (
    <g>
      <rect x={item.x} y={item.y} width={item.width} height={item.height} rx={8} fill={colors.soft} stroke={INK} strokeWidth={1.25} />
      <text x={item.x + item.width / 2} y={item.y + PARTY_BOX_HEIGHT / 2 - 12} textAnchor="middle" fontSize={13} fontWeight={700} fill={INK}>{truncate(party.name, 12)}{party.percentage > 0 ? ` ${formatPercent(party.percentage)}` : ""}</text>
      <text x={item.x + item.width / 2} y={item.y + PARTY_BOX_HEIGHT / 2 + 6} textAnchor="middle" fontSize={10.5} fill={MUTED}>{PAYMENT_TERM_LABELS[party.term]}</text>
      {party.note && <text x={item.x + item.width / 2} y={item.y + PARTY_BOX_HEIGHT / 2 + 21} textAnchor="middle" fontSize={9.5} fill={MUTED}>{truncate(party.note, 16)}</text>}
      {party.relatedParty && (
        <g>
          <rect x={item.x + item.width - 58} y={item.y - 11} width={58} height={18} rx={9} fill={RELATED} />
          <text x={item.x + item.width - 29} y={item.y + 2} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#fff">關係人</text>
        </g>
      )}
    </g>
  );
}

function formatPercent(value: number) {
  return `${Number.isInteger(value) ? value : Math.round(value * 10) / 10}%`;
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
