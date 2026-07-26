"use client";

import Link from "next/link";
import { formatBytes } from "@/lib/image-compress";
import { getToolManifest } from "@/lib/tools";
import { workspaceContinuationTargets } from "@/lib/workspace-continuation";
import type { WorkspaceItem } from "@/lib/workspace/types";

function relativeTime(iso: string): string {
  const elapsed = Date.now() - Date.parse(iso);
  if (!Number.isFinite(elapsed)) return "";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "剛剛";
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時前`;
  return `${Math.floor(hours / 24)} 天前`;
}

/** 到期時間換算成「還剩多久」。已經過期但還沒清掉時顯示「即將清除」。 */
function expiryLabel(item: WorkspaceItem): string {
  if (item.pinned || !item.expiresAt) return "已保留，不會自動清除";
  const remaining = Date.parse(item.expiresAt) - Date.now();
  if (!Number.isFinite(remaining)) return "";
  if (remaining <= 0) return "即將自動清除";
  const hours = Math.floor(remaining / 3_600_000);
  return hours >= 1 ? `${hours} 小時後自動清除` : `${Math.max(1, Math.floor(remaining / 60_000))} 分鐘後自動清除`;
}

type WorkspaceItemCardProps = {
  item: WorkspaceItem;
  items: readonly WorkspaceItem[];
  busy: boolean;
  duplicateOf: string | null;
  onDownload: (item: WorkspaceItem) => void;
  onTogglePinned: (id: string, pinned: boolean) => void;
  onRemove: (id: string) => void;
};

export function WorkspaceItemCard({ item, items, busy, duplicateOf, onDownload, onTogglePinned, onRemove }: WorkspaceItemCardProps) {
  const source = item.sourceTool ? getToolManifest(item.sourceTool) : undefined;
  const sourceLabel = source ? source.name : item.sourceTool ? item.sourceTool : "手動加入";
  const continuation = workspaceContinuationTargets(item, items)[0];

  return (
    <li id={`workspace-item-${item.id}`} className={item.pinned ? "compressor-item ws-item compressor-item-done" : "compressor-item ws-item"}>
      <div className="compressor-item-info">
        <strong>{item.name}</strong>
        <span>
          {formatBytes(item.sizeBytes)} · {sourceLabel} · {relativeTime(item.createdAt)} · {expiryLabel(item)}
          {duplicateOf ? ` · 內容與「${duplicateOf}」相同` : ""}
          {continuation ? ` · 可接到「${continuation.name}」` : ""}
        </span>
      </div>
      <div className="ws-item-actions">
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
          aria-pressed={item.pinned}
          onClick={() => onTogglePinned(item.id, !item.pinned)}
        >
          {item.pinned ? "取消保留" : "保留"}
        </button>
        <button className="button button-small button-secondary" type="button" disabled={busy} onClick={() => onDownload(item)}>
          下載
        </button>
        <button className="button button-small button-secondary" type="button" disabled={busy} onClick={() => onRemove(item.id)}>
          刪除<span className="sr-only">「{item.name}」</span>
        </button>
      </div>
    </li>
  );
}
