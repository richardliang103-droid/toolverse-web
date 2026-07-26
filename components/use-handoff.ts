"use client";

import { useEffect, useRef, useState } from "react";
import { detectFileType } from "@/lib/intake/detect-file";
import { getToolManifest } from "@/lib/tool-manifest";
import { consumeHandoff, handoffSourceName, takeHandoff, type HandoffKind } from "@/lib/handoff";

export type HandoffStatus = {
  kind: "info" | "error";
  text: string;
  action?: { label: string; onClick: () => void };
} | null;

function toolName(slug: string): string {
  return getToolManifest(slug)?.name ?? slug;
}

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot).toLowerCase() : null;
}

function mimeOf(file: File): string {
  return file.type.toLowerCase().split(";")[0]?.trim() ?? "";
}

function acceptsDeclaredFormat(file: File, input: { mimeTypes?: string[]; extensions?: string[] }): boolean {
  const mime = mimeOf(file);
  const extension = extensionOf(file.name);
  return Boolean(
    (mime !== "" && input.mimeTypes?.includes(mime))
    || (extension !== null && input.extensions?.includes(extension)),
  );
}

/** 交接時再驗一次實際內容，避免 URL token 指到格式不符或改過副檔名的檔案。 */
async function validateFile(file: File, targetSlug: string): Promise<string | null> {
  const manifest = getToolManifest(targetSlug);
  const input = manifest?.inputs.find((candidate) => candidate.kind === "file");
  if (!input) return `「${toolName(targetSlug)}」目前沒有檔案接收入口`;
  if (input.maxSizeBytes !== undefined && file.size > input.maxSizeBytes) {
    return `「${file.name}」超過「${toolName(targetSlug)}」的檔案大小上限`;
  }
  // 有些作業系統交給瀏覽器的 File.type 是空字串；這時先讓 magic bytes
  // 判斷，不能因為宣告值空白就把副檔名正確的檔案擋掉。
  const declaredAccepted = acceptsDeclaredFormat(file, input);
  if (!declaredAccepted && mimeOf(file) !== "") {
    return `「${file.name}」的 MIME 或副檔名不是「${toolName(targetSlug)}」支援的格式`;
  }

  const bytes = await file.slice(0, 4096).arrayBuffer();
  const detected = detectFileType({ name: file.name, declaredType: file.type, bytes: new Uint8Array(bytes) });
  if (detected.source !== "unknown") {
    const actualMimeAccepted = input.mimeTypes?.includes(detected.mimeType) ?? false;
    const actualExtensionAccepted = detected.extension !== null && (input.extensions?.includes(detected.extension) ?? false);
    if (!actualMimeAccepted && !actualExtensionAccepted) {
      return `「${file.name}」的實際格式是 ${detected.label}，不是「${toolName(targetSlug)}」支援的格式`;
    }
  } else if (!declaredAccepted) {
    return `無法確認「${file.name}」的格式是否受「${toolName(targetSlug)}」支援`;
  }
  return null;
}

function removeWorkspaceQuery(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("workspaceItem");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function useHandoffOfKind(
  kind: HandoffKind,
  targetSlug: string,
  allowBatch: boolean,
  apply: (handoff: { files?: File[]; text?: string; fromName: string }) => void,
): HandoffStatus {
  const [status, setStatus] = useState<HandoffStatus>(null);
  const consumedRef = useRef(false);
  const applyRef = useRef(apply);

  useEffect(() => {
    applyRef.current = apply;
  }, [apply]);

  useEffect(() => {
    if (consumedRef.current) return;
    consumedRef.current = true;
    const workspaceItemId = new URLSearchParams(window.location.search).get("workspaceItem");
    if (!workspaceItemId) return;

    let active = true;
    void takeHandoff(kind, workspaceItemId).then(async (handoff) => {
      if (!active) return;
      if (!handoff) {
        setStatus({ kind: "error", text: "找不到這份接力內容，可能已過期或已被使用。" });
        return;
      }
      const fromName = handoffSourceName(handoff.fromSlug);
      if (handoff.kind === "text") {
        const manifest = getToolManifest(targetSlug);
        if (!manifest?.inputs.some((input) => input.kind === "text")) {
          setStatus({ kind: "error", text: `「${toolName(targetSlug)}」不接受文字接力。` });
          return;
        }
        setStatus({
          kind: "info",
          text: `已從「${fromName}」讀取文字，請確認後開始處理。`,
          action: {
            label: "確認帶入",
            onClick: () => {
              consumeHandoff(handoff);
              removeWorkspaceQuery();
              setStatus({ kind: "info", text: `已從「${fromName}」帶入文字。` });
              applyRef.current({ text: handoff.text, fromName });
            },
          },
        });
        return;
      }

      if (!allowBatch && handoff.files.length > 1) {
        setStatus({ kind: "error", text: `這份接力包含 ${handoff.files.length} 個檔案，「${toolName(targetSlug)}」一次只能接收一個。` });
        return;
      }
      for (const file of handoff.files) {
        const problem = await validateFile(file, targetSlug);
        if (problem) {
          setStatus({ kind: "error", text: problem });
          return;
        }
      }
      setStatus({
        kind: "info",
        text: `已從「${fromName}」讀取 ${handoff.files.length > 1 ? `${handoff.files.length} 個檔案` : "檔案"}，請確認後開始處理。`,
        action: {
          label: "確認帶入",
          onClick: () => {
            consumeHandoff(handoff);
            removeWorkspaceQuery();
            setStatus({ kind: "info", text: `已從「${fromName}」帶入 ${handoff.files.length > 1 ? `${handoff.files.length} 個檔案` : "檔案"}。` });
            applyRef.current({ files: handoff.files, fromName });
          },
        },
      });
    }).catch(() => {
      if (active) setStatus({ kind: "error", text: "讀取工作區接力失敗，請回到來源工具再試一次。" });
    });

    return () => { active = false; };
  }, [kind, targetSlug, allowBatch]);

  return status;
}

/** 單檔工具的接收端。 */
export function useHandoff(targetSlug: string, onReceive: (file: File, fromName: string) => void): HandoffStatus {
  return useHandoffOfKind("file", targetSlug, false, ({ files, fromName }) => {
    const file = files?.[0];
    if (file) onReceive(file, fromName);
  });
}

/** 可接收整批檔案的工具入口。 */
export function useHandoffFiles(targetSlug: string, onReceive: (files: File[], fromName: string) => void): HandoffStatus {
  return useHandoffOfKind("file", targetSlug, true, ({ files, fromName }) => {
    if (files?.length) onReceive(files, fromName);
  });
}

/** 文字工具的接收端。 */
export function useTextHandoff(targetSlug: string, onReceive: (text: string, fromName: string) => void): HandoffStatus {
  return useHandoffOfKind("text", targetSlug, false, ({ text, fromName }) => {
    if (text !== undefined) onReceive(text, fromName);
  });
}
