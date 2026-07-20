"use client";

import { useEffect, useRef, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

// 捲動顯現（gsap-scrolltrigger 模式）：捲到視窗 85% 高度時，
// 區塊內的 [data-rise] 子元素依序上升。只動 transform；
// gsap.context + ctx.revert() 同時清掉 tween 與 ScrollTrigger。
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const scopeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      const scope = scopeRef.current;
      if (!scope) return;
      const targets = gsap.utils.toArray<HTMLElement>("[data-rise]", scope);
      if (targets.length === 0) return;
      gsap.from(targets, {
        y: 30,
        duration: 0.65,
        ease: "power3.out",
        stagger: 0.12,
        clearProps: "transform",
        scrollTrigger: { trigger: scope, start: "top 85%" },
      });
    }, scopeRef);
    return () => ctx.revert();
  }, []);

  return <div ref={scopeRef} className={className}>{children}</div>;
}
