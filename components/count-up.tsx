"use client";

import { useEffect, useRef } from "react";

const DURATION_MS = 550;

// 改寫自 react-bits 的 CountUp：整數值變化時滾動到新值。
// 動畫直接改 textContent、不走 React state，不觸發 re-render；
// SSR 與首次 render 都直接顯示最終值，之後值變化才有動畫。
// startFrom 給「結果一出現就從某數滾上來」的場景（例如壓縮完成的節省 %）。
export function CountUp({ value, startFrom }: { value: number; startFrom?: number }) {
  const spanRef = useRef<HTMLSpanElement | null>(null);
  const shownRef = useRef<number | null>(null);

  useEffect(() => {
    const span = spanRef.current;
    if (!span) return;
    const from = shownRef.current ?? startFrom ?? value;
    shownRef.current = value;
    if (from === value || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      span.textContent = value.toLocaleString();
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / DURATION_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      span.textContent = Math.round(from + (value - from) * eased).toLocaleString();
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    // rAF 被節流或凍結時，時間到仍保證停在正確的最終值。
    const safety = window.setTimeout(() => { span.textContent = value.toLocaleString(); }, DURATION_MS + 120);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(safety); };
  }, [value, startFrom]);

  return <span ref={spanRef} className="count-up">{value.toLocaleString()}</span>;
}
