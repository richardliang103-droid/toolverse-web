"use client";

import { useMemo, useState } from "react";
import { ToolCard } from "@/components/tool-card";
import { CATEGORIES, filterTools, type CategoryId } from "@/lib/tools";

// 首頁工具目錄：分類 chips ＋ 即時搜尋。
// 初始狀態（全部、無關鍵字）在 SSR 就渲染完整清單，搜尋引擎看得到所有工具。
export function ToolDirectory() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryId | "all">("all");
  const visible = useMemo(() => filterTools(query, category), [query, category]);

  return (
    <>
      <div className="directory-filters page-shell">
        <label className="sr-only" htmlFor="tool-search">搜尋工具</label>
        <input
          id="tool-search"
          className="directory-search"
          type="search"
          placeholder="搜尋工具，例如：抽獎、PDF、密碼…"
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
        {visible.map((tool) => (
          <ToolCard className={`compact-tool compact-tool-${tool.accent}`} href={`/tools/${tool.slug}`} key={tool.slug}>
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
