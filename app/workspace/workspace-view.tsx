"use client";

import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { usePersonalTools } from "@/components/personal/use-personal-tools";
import { WorkspaceItemCard } from "@/components/workspace/workspace-item-card";
import { useWorkspace } from "@/components/workspace/use-workspace";
import { formatBytes } from "@/lib/image-compress";

/**
 * 同 checksum 的項目互相標註來源，讓使用者看得出哪幾份其實是同一個東西。
 *
 * 清單是新到舊排的，這裡要由舊往新掃：先存進來的那份才是「原本那個」，
 * 後來的才標成重複。
 */
function duplicateNames(items: { id: string; name: string; checksumSha256?: string }[]): Map<string, string> {
  const firstByChecksum = new Map<string, string>();
  const duplicates = new Map<string, string>();
  for (const item of [...items].reverse()) {
    if (!item.checksumSha256) continue;
    const original = firstByChecksum.get(item.checksumSha256);
    if (original) duplicates.set(item.id, original);
    else firstByChecksum.set(item.checksumSha256, item.name);
  }
  return duplicates;
}

export function WorkspaceView() {
  const {
    items,
    usage,
    backend,
    ready,
    busy,
    notice,
    addFiles,
    remove,
    togglePinned,
    clearAll,
    download,
    exportBackup,
    importBackup,
  } = useWorkspace();
  const {
    favoriteSlugs,
    recentSlugs,
    trackRecent,
    hydrated: personalHydrated,
    mergePersonalTools,
  } = usePersonalTools();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const duplicates = useMemo(() => duplicateNames(items), [items]);

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 0) void addFiles(event.dataTransfer.files);
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void addFiles(event.target.files);
    // 清掉 value，否則選同一個檔案第二次不會觸發 change。
    event.target.value = "";
  }

  function onBackupPick(event: ChangeEvent<HTMLInputElement>) {
    const archive = event.target.files?.[0];
    if (archive) void importBackup(archive, mergePersonalTools);
    event.target.value = "";
  }

  const quotaLine = usage?.quotaBytes && usage.originUsageBytes !== null
    ? `此網站已用 ${formatBytes(usage.originUsageBytes)} / 可用 ${formatBytes(usage.quotaBytes)}`
    : "這個瀏覽器沒有提供可用空間的估算值。";

  return (
    <section className="page-shell ws-page">
      <div className="panel ws-summary">
        <div className="panel-header">
          <h2>目前狀態</h2>
          <span className="panel-meta">{backend === "opfs" ? "OPFS 儲存" : backend === "indexeddb" ? "IndexedDB 儲存" : "偵測中…"}</span>
        </div>
        <dl className="ws-stats">
          <div><dt>項目</dt><dd>{ready ? items.length : "—"}</dd></div>
          <div><dt>保留中</dt><dd>{ready && usage ? usage.pinnedCount : "—"}</dd></div>
          <div><dt>檔案大小總計</dt><dd>{ready && usage ? formatBytes(usage.totalBytes) : "—"}</dd></div>
        </dl>
        <p className="file-note">{quotaLine}</p>
      </div>

      <div className="panel ws-backup" id="backup">
        <div className="panel-header">
          <div>
            <h2>備份與移轉</h2>
            <p>把收藏、最近使用設定與所有工作區檔案收進一個 ZIP，方便換裝置或自行留存。</p>
          </div>
          <span className="panel-meta">全程本機處理</span>
        </div>
        <div className="ws-backup-actions">
          <button
            className="button button-small button-blue"
            type="button"
            disabled={busy || !ready || !personalHydrated}
            onClick={() => {
              void exportBackup({ favoriteSlugs, recentSlugs, trackRecent });
            }}
          >
            匯出備份
          </button>
          <button
            className="button button-small button-secondary"
            type="button"
            disabled={busy || !personalHydrated}
            onClick={() => backupInputRef.current?.click()}
          >
            合併匯入備份
          </button>
          <input
            ref={backupInputRef}
            className="file-input"
            type="file"
            accept=".zip,application/zip"
            onChange={onBackupPick}
            disabled={busy}
            aria-label="選擇 ToolVerse 備份 ZIP"
          />
        </div>
        <p className="file-note">
          匯入不會刪除目前資料；同名檔案會自動加上序號。若任一邊停用最近使用，匯入後仍維持停用。
        </p>
      </div>

      <div
        className={dragging ? "drop-zone ws-drop dragging" : "drop-zone ws-drop"}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <div>
          <div className="drop-icon" aria-hidden="true">▣</div>
          <h2>把檔案拖到這裡</h2>
          <p>檔案會存在這台裝置的瀏覽器裡，不會上傳。</p>
          <span className="button button-secondary">選擇檔案</span>
          <input ref={inputRef} className="file-input" type="file" multiple onChange={onPick} disabled={busy} aria-label="選擇要加入工作區的檔案" />
          <small className="file-note">未標記保留的項目會在 24 小時後自動清除。</small>
        </div>
      </div>

      {notice && <p className={notice.kind === "error" ? "gantt-notice gantt-notice-error" : "gantt-notice gantt-notice-info"} role="status">{notice.text}</p>}

      <div className="panel">
        <div className="panel-header">
          <h2>工作區項目</h2>
          {items.length > 0 && (
            confirmingClear
              ? <span className="ws-confirm">
                  <span>確定要清空？</span>
                  <button className="button button-small button-coral" type="button" disabled={busy} onClick={() => { setConfirmingClear(false); void clearAll(); }}>清空全部</button>
                  <button className="button button-small button-secondary" type="button" onClick={() => setConfirmingClear(false)}>取消</button>
                </span>
              : <button className="button button-small button-secondary" type="button" disabled={busy} onClick={() => setConfirmingClear(true)}>清除全部</button>
          )}
        </div>

        {!ready && <p className="result-empty"><strong>載入中…</strong>正在讀取這台裝置上的工作區。</p>}

        {ready && items.length === 0 && (
          <p className="result-empty"><strong>還沒有項目</strong>把檔案拖進上面的區域，或之後從工具把處理結果存進來。</p>
        )}

        {items.length > 0 && (
          <ul className="compressor-list">
            {items.map((item) => (
              <WorkspaceItemCard
                key={item.id}
                item={item}
                items={items}
                busy={busy}
                duplicateOf={duplicates.get(item.id) ?? null}
                onDownload={download}
                onTogglePinned={togglePinned}
                onRemove={remove}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
