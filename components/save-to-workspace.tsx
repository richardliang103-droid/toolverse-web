"use client";

import { useState } from "react";
import { getWorkspaceRepository } from "@/lib/workspace/create";
import { WorkspaceQuotaError } from "@/lib/workspace/types";

type SaveToWorkspaceProps = {
  blob: Blob | null;
  name: string;
  sourceTool: string;
};

/** 工具輸出共用的「存到本機工作區」入口。 */
export function SaveToWorkspace({ blob, name, sourceTool }: SaveToWorkspaceProps) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  if (!blob) return null;
  const outputBlob = blob;

  async function save() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const repository = await getWorkspaceRepository();
      const item = await repository.save({ name, blob: outputBlob, mimeType: outputBlob.type, sourceTool });
      setNotice({ kind: "info", text: `已存到工作區：${item.name}` });
    } catch (caught) {
      setNotice({
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
      {notice && <span className={notice.kind === "error" ? "error-message" : "gantt-notice-info"} role="status">{notice.text}</span>}
    </div>
  );
}
