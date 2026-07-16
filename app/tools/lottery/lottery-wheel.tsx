"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import gsap from "gsap";

export type LotteryWheelHandle = { spinTo: (targetIndex: number, duration: number) => Promise<void> };

// Above this many participants, per-slice name labels stop being legible, so
// the wheel falls back to a plain neon-rainbow ring (still lands on the
// exact correct slice — the winner is revealed via the flash card + list
// instead of being read off the wheel itself).
const TEXT_LABEL_LIMIT = 14;
const VIEWBOX = 360;

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

export const LotteryWheel = forwardRef<LotteryWheelHandle, { segments: string[] }>(function LotteryWheel(
  { segments },
  ref,
) {
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
          const desiredMod = (((360 - stopAngle) % 360) + 360) % 360;
          const currentRotation = (gsap.getProperty(node, "rotation") as number) || 0;
          const currentMod = ((currentRotation % 360) + 360) % 360;
          const forwardDelta = ((desiredMod - currentMod) % 360 + 360) % 360;
          const extraSpins = 6 + Math.floor(Math.random() * 3);
          gsap.to(node, {
            rotation: `+=${extraSpins * 360 + forwardDelta}`,
            duration,
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
      segments.map((name, index) => {
        const startAngle = index * anglePer;
        const endAngle = startAngle + anglePer;
        const midAngle = startAngle + anglePer / 2;
        const hue = Math.round((index / count) * 320 + 300) % 360;
        const light = index % 2 === 0 ? 57 : 45;
        const label = name.length > 7 ? `${name.slice(0, 6)}…` : name;
        const flip = midAngle > 90 && midAngle < 270;
        const labelPos = polarToCartesian(cx, cy, r * 0.64, midAngle);
        const labelRotate = flip ? midAngle - 90 + 180 : midAngle - 90;
        return {
          path: describeSlice(cx, cy, r, startAngle, endAngle),
          fill: `hsl(${hue} 88% ${light}%)`,
          key: `${name}-${index}`,
          labelPos,
          labelRotate,
          label,
          flip,
        };
      }),
    [segments, anglePer, count, cx, cy, r],
  );

  return (
    <div className="lottery-wheel-shell">
      <div className="lottery-wheel-pointer" aria-hidden="true" />
      <svg className="lottery-wheel-svg" viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`} role="img" aria-label="抽獎轉盤">
        <defs>
          <radialGradient id="wheelHub" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="#fff7ff" />
            <stop offset="55%" stopColor="#f4baff" />
            <stop offset="100%" stopColor="#a855f7" />
          </radialGradient>
        </defs>
        <g ref={rotorRef}>
          {segments.length === 0 ? (
            <circle cx={cx} cy={cy} r={r} fill="#221033" stroke="#4c2a73" strokeWidth={2} />
          ) : (
            slices.map((slice) => (
              <g key={slice.key}>
                <path d={slice.path} fill={slice.fill} stroke="#150a24" strokeWidth={1.5} />
                {showLabels && (
                  <text
                    x={slice.labelPos.x}
                    y={slice.labelPos.y}
                    transform={`rotate(${slice.labelRotate} ${slice.labelPos.x} ${slice.labelPos.y})`}
                    textAnchor={slice.flip ? "end" : "start"}
                    dominantBaseline="middle"
                    className="lottery-wheel-label"
                  >
                    {slice.label}
                  </text>
                )}
              </g>
            ))
          )}
          <circle cx={cx} cy={cy} r={r * 0.16} fill="url(#wheelHub)" stroke="#fff" strokeWidth={2} />
        </g>
      </svg>
    </div>
  );
});
