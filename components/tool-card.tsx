"use client";

import Link from "next/link";
import { useRef, type ReactNode } from "react";

// 改寫自 react-bits 的 SpotlightCard：滑鼠在卡片上時，柔和光暈跟著游標移動。
// 直接寫 CSS 變數、不觸發 re-render；光暈畫在 ::after，不影響卡片內容與鍵盤操作。
type ToolCardProps = {
  href: string;
  className: string;
  children: ReactNode;
  toolName: string;
  favorite: boolean;
  onToggleFavorite: () => void;
};

export function ToolCard({ href, className, children, toolName, favorite, onToggleFavorite }: ToolCardProps) {
  const cardRef = useRef<HTMLAnchorElement | null>(null);

  const handleMouseMove = (event: React.MouseEvent<HTMLAnchorElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
    card.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
  };

  return <article className="compact-tool-frame">
    <Link ref={cardRef} className={`${className} spotlight-card`} href={href} onMouseMove={handleMouseMove}>
      {children}
    </Link>
    <button
      className={favorite ? "compact-tool-favorite compact-tool-favorite-active" : "compact-tool-favorite"}
      type="button"
      aria-pressed={favorite}
      aria-label={favorite ? `取消收藏「${toolName}」` : `收藏「${toolName}」`}
      onClick={onToggleFavorite}
    >
      <span aria-hidden="true">{favorite ? "★" : "☆"}</span>
    </button>
  </article>;
}
