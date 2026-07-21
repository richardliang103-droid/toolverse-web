"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import gsap from "gsap";
import type { Participant } from "@/lib/lottery";

export type LotteryWheelHandle = { spinTo: (targetIndex: number, duration: number) => Promise<void> };

// Above this many participants, per-slice name labels stop being legible, so
// the wheel falls back to a plain alternating charcoal/gold ring (still lands
// on the exact correct slice — the winner is revealed via the flash card +
// list instead of being read off the wheel itself).
const TEXT_LABEL_LIMIT = 12;
const VIEWBOX = 360;

// The pointer sits at the 3 o'clock position (not 12 o'clock): a name landing
// there reads horizontally instead of sideways/vertical.
const POINTER_ANGLE = 90;

export type WheelTheme = "neon" | "wa";

// 每個主題一組色盤：neon 是深夜藍＋香檳金；wa 是日系和色粉彩
// （縹・鴇・松葉・藤）配深色文字，走淺色和紙路線。
const THEME_STYLES: Record<WheelTheme, {
  tones: Array<{ fill: string; text: string }>;
  sliceStroke: string;
  emptyFill: string;
  emptyStroke: string;
  hubStops: [string, string, string];
  hubStroke: string;
}> = {
  neon: {
    tones: [
      { fill: "#101927", text: "#f7f3e9" },
      { fill: "#1b2940", text: "#f7f3e9" },
      { fill: "#b98a42", text: "#16100a" },
    ],
    sliceStroke: "#080d16",
    emptyFill: "#101927",
    emptyStroke: "#46536a",
    hubStops: ["#fff8e6", "#f0c869", "#a5731f"],
    hubStroke: "#fff8e6",
  },
  wa: {
    tones: [
      { fill: "#dce7f1", text: "#2c4a66" },
      { fill: "#f7e3e8", text: "#8d4a58" },
      { fill: "#e6eeda", text: "#4d6238" },
      { fill: "#e8e1f3", text: "#584a7d" },
    ],
    sliceStroke: "#fffdf7",
    emptyFill: "#eef2f6",
    emptyStroke: "#c3cfdb",
    hubStops: ["#ffffff", "#a8c4da", "#5F83A8"],
    hubStroke: "#fffdf7",
  },
};

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeSlice(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

export const LotteryWheel = forwardRef<LotteryWheelHandle, { segments: Participant[]; theme?: WheelTheme }>(function LotteryWheel(
  { segments, theme = "neon" },
  ref,
) {
  const style = THEME_STYLES[theme];
  const rotorRef = useRef<SVGGElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      spinTo(targetIndex, duration) {
        return new Promise<void>((resolve) => {
          const node = rotorRef.current;
          const count = segments.length;
          if (!node || !count) {
            resolve();
            return;
          }
          const anglePer = 360 / count;
          // Land somewhere within the middle ~70% of the slice, never right on the seam.
          const jitter = anglePer * (0.16 + Math.random() * 0.68);
          const stopAngle = targetIndex * anglePer + jitter;
          const desiredMod = (((POINTER_ANGLE - stopAngle) % 360) + 360) % 360;
          const currentRotation = (gsap.getProperty(node, "rotation") as number) || 0;
          const currentMod = ((currentRotation % 360) + 360) % 360;
          const forwardDelta = ((desiredMod - currentMod) % 360 + 360) % 360;
          const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          const extraSpins = reduceMotion ? 0 : 6 + Math.floor(Math.random() * 3);
          gsap.to(node, {
            rotation: `+=${extraSpins * 360 + forwardDelta}`,
            duration: reduceMotion ? 0 : duration,
            ease: "power3.out",
            transformOrigin: "50% 50%",
            onComplete: () => resolve(),
          });
        });
      },
    }),
    [segments],
  );

  const cx = VIEWBOX / 2;
  const cy = VIEWBOX / 2;
  const r = VIEWBOX / 2 - 6;
  const count = Math.max(segments.length, 1);
  const anglePer = 360 / count;
  const showLabels = segments.length > 0 && segments.length <= TEXT_LABEL_LIMIT;

  const slices = useMemo(
    () =>
      segments.map((participant, index) => {
        const startAngle = index * anglePer;
        const endAngle = startAngle + anglePer;
        const midAngle = startAngle + anglePer / 2;
        const tone = style.tones[index % style.tones.length];
        const label = participant.label.length > 6 ? `${participant.label.slice(0, 5)}…` : participant.label;
        const labelPos = polarToCartesian(cx, cy, r * 0.62, midAngle);
        // 一律用 midAngle - 90（不做「下半圈加轉 180 度比較好讀」的最佳化）。
        // spinTo() 算出的轉盤停止角度，前提是每個標籤都用這個公式，中獎者
        // 停在指針（90 度）時才會精準水平；曾經對下半圈的標籤加轉 180 度讓
        // 靜止瀏覽時比較好讀，但那個額外的 180 度在指針對齊時完全沒被抵銷，
        // 導致原本排在下半圈的人中獎時，名字會剛好上下顛倒地停在指針上。
        const labelRotate = midAngle - 90;
        return {
          path: describeSlice(cx, cy, r, startAngle, endAngle),
          fill: tone.fill,
          textColor: tone.text,
          key: participant.id,
          labelPos,
          labelRotate,
          label,
        };
      }),
    [segments, anglePer, cx, cy, r, style.tones],
  );

  return (
    <div className="lottery-wheel-shell">
      <div className="lottery-wheel-pointer" aria-hidden="true" />
      <svg className="lottery-wheel-svg" viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`} role="img" aria-label="抽選轉盤">
        <defs>
          <radialGradient id={`wheelHub-${theme}`} cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor={style.hubStops[0]} />
            <stop offset="55%" stopColor={style.hubStops[1]} />
            <stop offset="100%" stopColor={style.hubStops[2]} />
          </radialGradient>
        </defs>
        <g ref={rotorRef}>
          {segments.length === 0 ? (
            <circle cx={cx} cy={cy} r={r} fill={style.emptyFill} stroke={style.emptyStroke} strokeWidth={2} />
          ) : (
            slices.map((slice) => (
              <g key={slice.key}>
                <path d={slice.path} fill={slice.fill} stroke={style.sliceStroke} strokeWidth={1.5} />
                {showLabels && (
                  <text
                    x={slice.labelPos.x}
                    y={slice.labelPos.y}
                    transform={`rotate(${slice.labelRotate} ${slice.labelPos.x} ${slice.labelPos.y})`}
                    textAnchor="start"
                    dominantBaseline="middle"
                    fill={slice.textColor}
                    className="lottery-wheel-label"
                  >
                    {slice.label}
                  </text>
                )}
              </g>
            ))
          )}
          <circle cx={cx} cy={cy} r={r * 0.16} fill={`url(#wheelHub-${theme})`} stroke={style.hubStroke} strokeWidth={2} />
        </g>
      </svg>
    </div>
  );
});
