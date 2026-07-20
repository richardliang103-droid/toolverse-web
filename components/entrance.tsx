"use client";

import { useEffect, useRef, type ReactNode } from "react";
import gsap from "gsap";

// 首頁進場編排（gsap-timeline 模式：一條 timeline 疊 stagger，不用 delay 串接）。
// 用 gsap.context + ctx.revert() 清理（gsap-react skill 認可的 useEffect 模式；
// 不用 @gsap/react，因為它在 vinext 的 vite 開發環境會產生第二份 React）。
// 只動 transform：動畫失效或凍結時內容仍完整可見、可讀。
export function Entrance({ children }: { children: ReactNode }) {
  const scopeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      const targets = gsap.utils.toArray<HTMLElement>("[data-rise]");
      if (targets.length === 0) return;
      const timeline = gsap.timeline({ defaults: { ease: "power3.out", duration: 0.7 } });
      timeline.from(targets, { y: 26, stagger: { each: 0.045, from: "start" }, clearProps: "transform" });
      const cards = gsap.utils.toArray<HTMLElement>(".compact-tool");
      if (cards.length > 0) {
        timeline.from(cards, { y: 30, duration: 0.6, stagger: { each: 0.03 }, clearProps: "transform" }, "-=0.5");
      }
    }, scopeRef);
    return () => ctx.revert();
  }, []);

  return <div ref={scopeRef} className="entrance-scope">{children}</div>;
}
