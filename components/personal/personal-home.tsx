"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePersonalTools } from "@/components/personal/use-personal-tools";
import { useWorkspace } from "@/components/workspace/use-workspace";
import { formatBytes } from "@/lib/image-compress";
import { getToolManifest, tools, type Tool } from "@/lib/tools";
import { workspaceContinuationTargets } from "@/lib/workspace-continuation";
import type { WorkspaceItem } from "@/lib/workspace/types";

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

function PersonalOutputItem({
  item,
  items,
  busy,
  onDownload,
}: {
  item: WorkspaceItem;
  items: readonly WorkspaceItem[];
  busy: boolean;
  onDownload: (item: WorkspaceItem) => Promise<void>;
}) {
  const sourceName = item.sourceTool ? getToolManifest(item.sourceTool)?.name ?? "其他工具" : "手動加入";
  const continuation = workspaceContinuationTargets(item, items)[0];

  return (
    <li>
      <span className="personal-output-copy">
        <strong>{item.name}</strong>
        <small>{continuation ? `${sourceName} · 可接到「${continuation.name}」` : sourceName}</small>
      </span>
      <span className="personal-output-actions">
        {continuation && (
          <Link
            className="button button-small button-secondary"
            href={`/tools/${continuation.slug}?workspaceItem=${encodeURIComponent(item.id)}`}
            aria-label={`用「${continuation.name}」繼續處理「${item.name}」`}
          >
            繼續處理
          </Link>
        )}
        <button
          className="button button-small button-secondary"
          type="button"
          disabled={busy}
          onClick={() => { void onDownload(item); }}
          aria-label={`下載「${item.name}」`}
        >
          下載
        </button>
        <Link
          className="button button-small button-secondary"
          href={`/workspace#workspace-item-${encodeURIComponent(item.id)}`}
          aria-label={`在工作區查看「${item.name}」`}
        >
          查看
        </Link>
      </span>
    </li>
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
  const { items, usage, ready, busy, notice, download } = useWorkspace();
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
            ? <p className="personal-empty" role="alert">{notice.text}</p>
            : <>
                <dl className="personal-workspace-stats">
                  <div><dt>使用量</dt><dd>{ready && usage ? formatBytes(usage.totalBytes) : "—"}</dd></div>
                  <div><dt>保留中</dt><dd>{ready && usage ? usage.pinnedCount : "—"}</dd></div>
                </dl>
                {ready && recentOutputs.length === 0 && <p className="personal-empty">還沒有工具輸出。處理完成後可直接存到這裡。</p>}
                {recentOutputs.length > 0 && (
                  <ul className="personal-output-list">
                    {recentOutputs.map((item) => (
                      <PersonalOutputItem
                        key={item.id}
                        item={item}
                        items={items}
                        busy={busy}
                        onDownload={download}
                      />
                    ))}
                  </ul>
                )}
              </>}
          <Link className="button button-small button-secondary personal-workspace-link" href="/workspace#backup">管理與備份 →</Link>
        </article>
      </div>
    </section>
  );
}
