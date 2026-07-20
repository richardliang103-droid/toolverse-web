"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ToolCard } from "@/components/tool-card";
import { CATEGORIES, filterTools, type CategoryId } from "@/lib/tools";

function isTypingTarget(element: EventTarget | null) {
  if (!(element instanceof HTMLElement)) return false;
  return element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

// 首頁工具目錄：分類 chips ＋ 即時搜尋。
// 初始狀態（全部、無關鍵字）在 SSR 就渲染完整清單，搜尋引擎看得到所有工具。
// 快速鍵：/ 聚焦搜尋框，Esc 清除條件並離開搜尋框。
export function ToolDirectory() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryId | "all">("all");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const visible = useMemo(() => filterTools(query, category), [query, category]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "/" && !isTypingTarget(event.target)) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === "Escape") {
        setQuery("");
        setCategory("all");
        searchRef.current?.blur();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <div className="directory-filters page-shell" data-rise>
        <label className="sr-only" htmlFor="tool-search">搜尋工具</label>
        <input
          ref={searchRef}
          id="tool-search"
          className="directory-search"
          type="search"
          placeholder="搜尋工具（按 / 快速聚焦），例如：抽獎、PDF…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="directory-chips" role="group" aria-label="工具分類">
          <button className={category === "all" ? "directory-chip directory-chip-active" : "directory-chip"} type="button" onClick={() => setCategory("all")}>全部</button>
          {CATEGORIES.map((item) => (
            <button
              key={item.id}
              className={category === item.id ? "directory-chip directory-chip-active" : "directory-chip"}
              type="button"
              onClick={() => setCategory((current) => (current === item.id ? "all" : item.id))}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <section className="compact-tool-grid page-shell" id="tools" aria-label="工具列表">
        {visible.map((tool, index) => (
          <ToolCard className={`compact-tool compact-tool-${tool.accent}`} href={`/tools/${tool.slug}`} key={tool.slug}>
            <span className="compact-tool-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <span className="compact-tool-icon" aria-hidden="true">{tool.symbol}</span>
            <span className="compact-tool-copy">
              <strong>{tool.name}</strong>
              <small>{tool.description}</small>
            </span>
            <span className="compact-tool-arrow" aria-hidden="true">→</span>
          </ToolCard>
        ))}
        {visible.length === 0 && (
          <p className="directory-empty">找不到符合「{query}」的工具。<button className="directory-clear" type="button" onClick={() => { setQuery(""); setCategory("all"); }}>清除條件</button></p>
        )}
      </section>
    </>
  );
}
