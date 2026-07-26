"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePersonalTools } from "@/components/personal/use-personal-tools";
import { useWorkspace } from "@/components/workspace/use-workspace";
import { formatBytes } from "@/lib/image-compress";
import { getToolManifest, tools, type Tool } from "@/lib/tools";

const TOOLS_BY_SLUG = new Map(tools.map((tool) => [tool.slug, tool]));

function resolveTools(slugs: readonly string[]): Tool[] {
  return slugs.flatMap((slug) => {
    const tool = TOOLS_BY_SLUG.get(slug);
    return tool ? [tool] : [];
  });
}

function PersonalToolLink({ tool }: { tool: Tool }) {
  return (
    <Link className="personal-tool-link" href={`/tools/${tool.slug}`}>
      <span className={`personal-tool-symbol personal-tool-symbol-${tool.accent}`} aria-hidden="true">{tool.symbol}</span>
      <span><strong>{tool.name}</strong><small>{tool.description}</small></span>
      <span aria-hidden="true">→</span>
    </Link>
  );
}

export function PersonalHome() {
  const {
    favoriteSlugs,
    recentSlugs,
    trackRecent,
    hydrated,
    toggleFavorite,
    setRecentTrackingEnabled,
  } = usePersonalTools();
  const { items, usage, ready, notice } = useWorkspace();
  const favoriteTools = useMemo(() => resolveTools(favoriteSlugs), [favoriteSlugs]);
  const recentTools = useMemo(() => resolveTools(recentSlugs), [recentSlugs]);
  const recentOutputs = useMemo(() => items.filter((item) => item.sourceTool !== null).slice(0, 3), [items]);

  return (
    <section className="personal-home page-shell" aria-labelledby="personal-home-title" data-rise>
      <div className="personal-home-heading">
        <div>
          <p className="directory-eyebrow">YOUR SPACE — 只存在這台裝置</p>
          <h2 id="personal-home-title">你的工具</h2>
          <p>收藏常用工具、接著上次的工作，全部留在瀏覽器裡。</p>
        </div>
        <label className="personal-privacy-toggle">
          <input
            type="checkbox"
            checked={!trackRecent}
            disabled={!hydrated}
            onChange={(event) => setRecentTrackingEnabled(!event.target.checked)}
          />
          <span><strong>不記錄最近使用</strong><small>開啟後會清除既有紀錄；收藏不受影響。</small></span>
        </label>
      </div>

      <div className="personal-home-grid">
        <article className="panel personal-panel">
          <div className="panel-header"><h3>收藏</h3><span className="panel-meta">{hydrated ? favoriteTools.length : "—"}</span></div>
          {!hydrated && <p className="personal-empty">正在讀取個人設定…</p>}
          {hydrated && favoriteTools.length === 0 && <p className="personal-empty">還沒有收藏。到下方工具卡按下星號，就會放在這裡。</p>}
          {favoriteTools.length > 0 && (
            <ul className="personal-tool-list">
              {favoriteTools.map((tool) => (
                <li className="personal-tool-list-favorite" key={tool.slug}>
                  <PersonalToolLink tool={tool} />
                  <button className="personal-unfavorite" type="button" onClick={() => toggleFavorite(tool.slug)} aria-label={`取消收藏「${tool.name}」`}>★</button>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="panel personal-panel">
          <div className="panel-header"><h3>最近使用</h3><span className="panel-meta">{trackRecent ? "最多 6 個" : "已停用"}</span></div>
          {!hydrated && <p className="personal-empty">正在讀取最近使用…</p>}
          {hydrated && !trackRecent && <p className="personal-empty">目前不記錄最近使用。工具內容、檔名與輸入原本就不會被記錄。</p>}
          {hydrated && trackRecent && recentTools.length === 0 && <p className="personal-empty">使用過工具後，這裡只會記住工具名稱，不會記住內容。</p>}
          {trackRecent && recentTools.length > 0 && (
            <ul className="personal-tool-list">
              {recentTools.map((tool) => <li key={tool.slug}><PersonalToolLink tool={tool} /></li>)}
            </ul>
          )}
        </article>

        <article className="panel personal-panel personal-workspace-panel">
          <div className="panel-header"><h3>本機工作區</h3><span className="panel-meta">{ready ? `${items.length} 個項目` : "讀取中…"}</span></div>
          {notice?.kind === "error"
            ? <p className="personal-empty">目前讀不到工作區，瀏覽器可能封鎖了本機儲存空間。</p>
            : <>
                <dl className="personal-workspace-stats">
                  <div><dt>使用量</dt><dd>{ready && usage ? formatBytes(usage.totalBytes) : "—"}</dd></div>
                  <div><dt>保留中</dt><dd>{ready && usage ? usage.pinnedCount : "—"}</dd></div>
                </dl>
                {ready && recentOutputs.length === 0 && <p className="personal-empty">還沒有工具輸出。處理完成後可直接存到這裡。</p>}
                {recentOutputs.length > 0 && (
                  <ul className="personal-output-list">
                    {recentOutputs.map((item) => (
                      <li key={item.id}>
                        <strong>{item.name}</strong>
                        <small>{item.sourceTool ? getToolManifest(item.sourceTool)?.name ?? "其他工具" : "手動加入"}</small>
                      </li>
                    ))}
                  </ul>
                )}
              </>}
          <Link className="button button-small button-secondary personal-workspace-link" href="/workspace">繼續處理 →</Link>
        </article>
      </div>
    </section>
  );
}
