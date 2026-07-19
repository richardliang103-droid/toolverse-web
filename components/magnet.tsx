"use client";

import { useRef, type ReactNode } from "react";

const MAX_SHIFT_PX = 5;

// 改寫自 react-bits 的 Magnet：游標在元素上時，內容朝游標輕微偏移，移開即彈回。
// 直接寫 style.transform（只動 transform），不觸發 re-render。
export function Magnet({ children, className }: { children: ReactNode; className?: string }) {
  const innerRef = useRef<HTMLSpanElement | null>(null);

  const handleMouseMove = (event: React.MouseEvent<HTMLSpanElement>) => {
    const inner = innerRef.current;
    if (!inner) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const shiftX = ((event.clientX - rect.left) / rect.width - 0.5) * 2 * MAX_SHIFT_PX;
    const shiftY = ((event.clientY - rect.top) / rect.height - 0.5) * 2 * MAX_SHIFT_PX;
    inner.style.transform = `translate(${shiftX.toFixed(1)}px, ${shiftY.toFixed(1)}px)`;
  };

  const handleMouseLeave = () => {
    const inner = innerRef.current;
    if (inner) inner.style.transform = "";
  };

  return (
    <span className={className ? `magnet ${className}` : "magnet"} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
      <span ref={innerRef} className="magnet-inner">{children}</span>
    </span>
  );
}
