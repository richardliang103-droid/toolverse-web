import type { ReactNode } from "react";

// 改寫自 react-bits 的 StarBorder：內容外圈有兩顆沿著上下緣流動的光點。
// 純 CSS keyframes（只動 transform），無 JS、無額外依賴。
export function StarBorder({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={className ? `star-border ${className}` : "star-border"}>
      <span className="star-border-glow star-border-glow-top" aria-hidden="true" />
      <span className="star-border-glow star-border-glow-bottom" aria-hidden="true" />
      <div className="star-border-content">{children}</div>
    </div>
  );
}
