"use client";

import { useState } from "react";
import { getWorkspaceRepository } from "@/lib/workspace/create";
import {
  WORKSPACE_HANDOFF_KIND_KEY,
  type WorkspaceHandoffKind,
} from "@/lib/workspace-continuation";
import { WorkspaceQuotaError } from "@/lib/workspace/types";

type SaveToWorkspaceProps = {
  blob: Blob | null;
  name: string;
  sourceTool: string;
  /** 讓這份輸出之後能從首頁接到相容工具；無法接力的檔案可省略。 */
  handoffKind?: WorkspaceHandoffKind;
};

/** 工具輸出共用的「存到本機工作區」入口。 */
export function SaveToWorkspace({ blob, name, sourceTool, handoffKind }: SaveToWorkspaceProps) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ blob: Blob; kind: "info" | "error"; text: string } | null>(null);

  if (!blob) return null;
  const outputBlob = blob;

  async function save() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const repository = await getWorkspaceRepository();
      const item = await repository.save({
        name,
        blob: outputBlob,
        mimeType: outputBlob.type,
        sourceTool,
        metadata: handoffKind ? { [WORKSPACE_HANDOFF_KIND_KEY]: handoffKind } : undefined,
      });
      setNotice({ blob: outputBlob, kind: "info", text: `已存到工作區：${item.name}` });
    } catch (caught) {
      setNotice({
        blob: outputBlob,
        kind: "error",
        text: caught instanceof WorkspaceQuotaError ? caught.message : "無法存到工作區，請重試。",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="send-to-tools">
      <span className="send-to-label">工作區</span>
      <button className="button button-small button-secondary" type="button" onClick={() => { void save(); }} disabled={busy}>
        {busy ? "存入中…" : "存到工作區"}
      </button>
      {notice?.blob === outputBlob && <span className={notice.kind === "error" ? "error-message" : "gantt-notice-info"} role="status">{notice.text}</span>}
    </div>
  );
}
