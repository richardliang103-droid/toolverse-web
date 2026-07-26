"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { acceptsHandoffFiles, describeHandoffFile } from "@/lib/handoff-compatibility";
import { putFileHandoff, putTextHandoff } from "@/lib/handoff";
import { getToolManifest } from "@/lib/tool-manifest";
import { tools } from "@/lib/tools";

const NAMES = new Map<string, string>(tools.map((tool) => [tool.slug, tool.name]));

type SendToToolsProps = {
  /** 來源工具 slug；會從清單排除自己。 */
  from: string;
  /** 可接收的目標工具。 */
  targets: readonly string[];
  /**
   * 產生要遞出去的內容。點下去才呼叫——像裁切這種結果取決於當下框選的工具，
   * 不必為了讓按鈕能用就每次拖曳都重算一遍。回傳 null 代表沒東西可送。
   *
   * getFile 與 getText 只會提供其中一個：圖片鏈用前者、文字鏈用後者。
   */
  getFile?: () => Promise<File | null> | File | null;
  /** 批次工具用這個一次遞交多個結果。 */
  getFiles?: () => readonly File[];
  getText?: () => string | null;
};

/**
 * 「送到 →」按鈕列：把結果直接交給下一個工具，不用下載再重新上傳、
 * 也不用複製貼上。
 *
 * 先把內容存進 Workspace，再用 router.push 導覽；目的地從 URL 的 workspaceItem
 * 讀回內容，不依賴來源頁面的記憶體狀態。
 */
export function SendToTools({ from, targets, getFile, getFiles, getText }: SendToToolsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const batchFiles = getFiles?.() ?? null;
  const visible = targets.filter((slug) => {
    if (slug === from) return false;
    if (!batchFiles) return true;
    const manifest = getToolManifest(slug);
    return Boolean(manifest && acceptsHandoffFiles(manifest, batchFiles.map(describeHandoffFile)));
  });

  async function send(slug: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      let workspaceItemId: string | null = null;
      if (getText) {
        const text = getText();
        if (!text) return;
        workspaceItemId = await putTextHandoff(text, from);
      } else if (getFiles) {
        const files = batchFiles ?? [];
        if (files.length === 0) return;
        workspaceItemId = await putFileHandoff(files, from);
      } else if (getFile) {
        const file = await getFile();
        if (!file) return;
        workspaceItemId = await putFileHandoff(file, from);
      } else {
        return;
      }
      router.push(`/tools/${slug}?workspaceItem=${encodeURIComponent(workspaceItemId)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "無法存入工作區，請重試。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="send-to-tools">
      <span className="send-to-label">送到</span>
      {visible.map((slug) => (
        <button
          key={slug}
          className="button button-small button-secondary"
          type="button"
          disabled={busy}
          onClick={() => { void send(slug); }}
        >
          {NAMES.get(slug) ?? slug}
        </button>
      ))}
      {error && <span className="error-message" role="alert">{error}</span>}
    </div>
  );
}
