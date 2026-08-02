"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { QUOTE_PAGE_WIDTH, QUOTE_SHADOW_OFFSET } from "@/lib/quote-builder";
import type { Quote, QuoteLayout } from "@/lib/quote-builder";

// 輸出面刻意固定配色（和紙白底＋和色），不隨深淺主題變動：
// 報價單會被下載成 PNG／SVG 寄給客戶或列印，底色必須永遠是白的。
const INK = "#101628";
const MUTED = "#656a76";
const LINE = "#ded8cc";
const PAPER = "#f5f1e8";
const HANADA = "#5f83a8"; // 縹
const FUJI = "#9b8bbf"; // 藤
const MATSUBA = "#7d9a63"; // 松葉
const TOKI = "#cf7f8d"; // 鴇
const PAGE = "#fffdf7";

export type QuoteSvgHandle = { exportSvg: () => string | null };

type Props = {
  quote: Quote;
  layout: QuoteLayout;
  /** 目前在表單中被聚焦的品項；只用於畫面預覽的高亮，匯出時一律傳 null。 */
  highlightItemId: string | null;
};

/**
 * 報價單的排版輸出面。**不接受任何互動事件**——高亮只透過
 * `highlightItemId` 進來，匯出用的那一份會傳 null，所以互動狀態
 * 不可能外洩到下載的 PNG／SVG 裡。
 */
export const QuoteSvg = forwardRef<QuoteSvgHandle, Props>(function QuoteSvg({ quote, layout, highlightItemId }, ref) {
  const svgRef = useRef<SVGSVGElement>(null);

  useImperativeHandle(ref, () => ({
    exportSvg() {
      return svgRef.current ? svgRef.current.outerHTML : null;
    },
  }));

  const pageHeight = layout.height - QUOTE_SHADOW_OFFSET;
  const partyWidth = (layout.contentRight - layout.contentLeft - 18) / 2;
  const buyerX = layout.contentLeft + partyWidth + 18;
  const totalsLabelX = layout.contentRight - 200;

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      width={layout.width}
      height={layout.height}
      // viewBox 從 0 起算並含入右下角陰影的溢出量（QUOTE_SHADOW_OFFSET），
      // 否則匯出的 SVG／PNG 會把陰影與外框切掉一角。
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      fontFamily='Inter, "Noto Sans TC", sans-serif'
      role="img"
      aria-label={`${quote.title} 預覽`}
    >
      {/* 紙張陰影：往右下偏移 QUOTE_SHADOW_OFFSET，已計入 viewBox。 */}
      <rect x={QUOTE_SHADOW_OFFSET} y={QUOTE_SHADOW_OFFSET} width={QUOTE_PAGE_WIDTH} height={pageHeight} fill={INK} opacity={0.12} />
      <rect x={0} y={0} width={QUOTE_PAGE_WIDTH} height={pageHeight} fill={PAGE} stroke={INK} strokeWidth={1} />
      <rect x={0} y={0} width={QUOTE_PAGE_WIDTH} height={6} fill={HANADA} />

      <text x={layout.contentLeft} y={layout.titleY} fontSize={26} fontWeight={800} fill={INK}>{quote.title}</text>
      <text x={layout.contentLeft} y={layout.titleY + 16} fontSize={10} letterSpacing={2} fill={MUTED}>QUOTATION</text>

      {layout.metaRows.map((row, index) => (
        <g key={row.label}>
          <text x={layout.contentRight - 120} y={layout.metaY + index * 18} fontSize={11} fill={MUTED}>{row.label}</text>
          <text x={layout.contentRight} y={layout.metaY + index * 18} fontSize={11.5} fontWeight={700} textAnchor="end" fill={INK}>{row.value}</text>
        </g>
      ))}

      {([
        { heading: "報價方", name: quote.seller.name || "（未填）", lines: layout.sellerLines, x: layout.contentLeft, accent: MATSUBA, y: layout.sellerY },
        { heading: "客戶", name: quote.buyer.name || "（未填）", lines: layout.buyerLines, x: buyerX, accent: FUJI, y: layout.buyerY },
      ] as const).map((party) => (
        <g key={party.heading}>
          <rect x={party.x} y={party.y} width={partyWidth} height={layout.partyBlockHeight} rx={6} fill="#ffffff" stroke={LINE} />
          <rect x={party.x} y={party.y} width={3} height={layout.partyBlockHeight} fill={party.accent} />
          <text x={party.x + 12} y={party.y + 17} fontSize={10} letterSpacing={1} fill={MUTED}>{party.heading}</text>
          <text x={party.x + 12} y={party.y + 36} fontSize={13.5} fontWeight={750} fill={INK}>{party.name}</text>
          {party.lines.map((line, index) => (
            <text key={`${party.heading}-${index}`} x={party.x + 12} y={party.y + 54 + index * 16} fontSize={10.5} fill={MUTED}>{line}</text>
          ))}
        </g>
      ))}

      <rect x={layout.contentLeft} y={layout.tableTop} width={layout.contentRight - layout.contentLeft} height={layout.tableHeaderHeight} fill={PAPER} />
      <text x={layout.columnX.index} y={layout.tableTop + 19} fontSize={10.5} fontWeight={700} fill={MUTED}>#</text>
      <text x={layout.columnX.name} y={layout.tableTop + 19} fontSize={10.5} fontWeight={700} fill={MUTED}>品名／規格</text>
      <text x={layout.columnX.quantity} y={layout.tableTop + 19} fontSize={10.5} fontWeight={700} textAnchor="end" fill={MUTED}>數量</text>
      <text x={layout.columnX.unitPrice} y={layout.tableTop + 19} fontSize={10.5} fontWeight={700} textAnchor="end" fill={MUTED}>單價</text>
      <text x={layout.columnX.amount} y={layout.tableTop + 19} fontSize={10.5} fontWeight={700} textAnchor="end" fill={MUTED}>小計</text>

      {layout.rows.map((row) => (
        <g key={row.id}>
          {row.id === highlightItemId && (
            <rect x={layout.contentLeft} y={row.y} width={layout.contentRight - layout.contentLeft} height={row.height} fill={HANADA} opacity={0.09} />
          )}
          <text x={layout.columnX.index} y={row.y + 19} fontSize={10.5} fill={MUTED}>{row.index}</text>
          <text x={layout.columnX.name} y={row.y + 19} fontSize={12} fontWeight={600} fill={INK}>{row.name}</text>
          {row.spec && <text x={layout.columnX.name} y={row.y + 34} fontSize={10} fill={MUTED}>{row.spec}</text>}
          <text x={layout.columnX.quantity} y={row.y + 19} fontSize={11.5} textAnchor="end" fill={INK}>{row.quantity}</text>
          <text x={layout.columnX.unitPrice} y={row.y + 19} fontSize={11.5} textAnchor="end" fill={INK}>{row.unitPrice}</text>
          <text x={layout.columnX.amount} y={row.y + 19} fontSize={11.5} fontWeight={650} textAnchor="end" fill={INK}>{row.amount}</text>
          <line x1={layout.contentLeft} y1={row.y + row.height} x2={layout.contentRight} y2={row.y + row.height} stroke={LINE} strokeWidth={1} />
        </g>
      ))}

      {layout.totalRows.map((row) => (
        <g key={row.label}>
          {row.emphasis && (
            <rect x={totalsLabelX - 14} y={row.y - 21} width={layout.contentRight - totalsLabelX + 14} height={30} rx={6} fill={PAPER} stroke={TOKI} strokeWidth={1.25} />
          )}
          <text x={totalsLabelX} y={row.y} fontSize={row.emphasis ? 12.5 : 11.5} fontWeight={row.emphasis ? 750 : 500} fill={row.emphasis ? INK : MUTED}>{row.label}</text>
          <text x={layout.contentRight - 8} y={row.y} fontSize={row.emphasis ? 16 : 12} fontWeight={row.emphasis ? 800 : 650} textAnchor="end" fill={INK}>{row.value}</text>
        </g>
      ))}
      <text x={layout.contentLeft} y={layout.totalsBottom - 6} fontSize={10} fill={MUTED}>{layout.taxNote}</text>

      {layout.footerBlocks.map((block) => (
        <g key={block.heading}>
          <text x={layout.contentLeft} y={block.y + 12} fontSize={10.5} fontWeight={720} fill={HANADA}>{block.heading}</text>
          {block.lines.map((line, index) => (
            <text key={`${block.heading}-${index}`} x={layout.contentLeft} y={block.y + 30 + index * 16} fontSize={10.5} fill={INK}>{line}</text>
          ))}
        </g>
      ))}
    </svg>
  );
});
