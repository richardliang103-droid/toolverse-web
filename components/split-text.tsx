"use client";

import { useEffect, useRef } from "react";

// 改寫自 react-bits 的 SplitText，動畫引擎用專案既有的 gsap。
// 只動 transform（不動 opacity），文字在任何時刻都看得到，動畫失效時也不影響閱讀。
export function SplitText({ text, className }: { text: string; className?: string }) {
  const rootRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    let tween: { kill: () => void } | null = null;
    void import("gsap").then(({ gsap }) => {
      if (cancelled || !root) return;
      tween = gsap.from(root.querySelectorAll(".split-text-char"), {
        y: 22,
        duration: 0.65,
        ease: "back.out(1.8)",
        stagger: 0.05,
        clearProps: "transform",
      });
    });
    return () => {
      cancelled = true;
      tween?.kill();
    };
  }, [text]);

  return (
    <span ref={rootRef} className={className}>
      {/* generic span 不允許 aria-label（aria-prohibited-attr），改用 sr-only 提供完整文字 */}
      <span className="sr-only">{text}</span>
      {Array.from(text).map((char, index) => (
        <span key={`${index}-${char}`} className="split-text-char" aria-hidden="true">
          {char === " " ? " " : char}
        </span>
      ))}
    </span>
  );
}
