/**
 * Workspace 項目的「繼續處理」目的地。
 *
 * 首頁只負責呈現；格式、大小、批次與接力能力都在這裡比對 manifest，
 * 避免再維護一份圖片／文字工具白名單。
 */
import {
  getToolManifest,
  toolManifests,
  type ToolInputCapability,
  type ToolManifest,
} from "./tool-manifest.ts";
import type { WorkspaceItem } from "./workspace/types.ts";

export type WorkspaceHandoffKind = "file" | "text";

export const WORKSPACE_HANDOFF_KIND_KEY = "handoffKind";
export const WORKSPACE_HANDOFF_GROUP_KEY = "handoffGroupId";
export const WORKSPACE_HANDOFF_INDEX_KEY = "handoffIndex";

function metadataString(item: WorkspaceItem, key: string): string | null {
  const value = item.metadata[key];
  return typeof value === "string" && value !== "" ? value : null;
}

export function workspaceHandoffKind(item: WorkspaceItem): WorkspaceHandoffKind | null {
  const kind = metadataString(item, WORKSPACE_HANDOFF_KIND_KEY);
  return kind === "file" || kind === "text" ? kind : null;
}

function groupSize(item: WorkspaceItem, items: readonly WorkspaceItem[]): number {
  const groupId = metadataString(item, WORKSPACE_HANDOFF_GROUP_KEY);
  if (!groupId) return 1;
  return Math.max(1, items.filter((candidate) =>
    workspaceHandoffKind(candidate) === "file"
    && metadataString(candidate, WORKSPACE_HANDOFF_GROUP_KEY) === groupId,
  ).length);
}

function acceptsFile(input: ToolInputCapability, item: WorkspaceItem, count: number): boolean {
  if (input.kind !== "file") return false;
  if (input.maxFiles !== undefined && count > input.maxFiles) return false;
  if (input.maxSizeBytes !== undefined && item.sizeBytes > input.maxSizeBytes) return false;
  const mimeAccepted = item.mimeType !== "" && (input.mimeTypes?.includes(item.mimeType.toLowerCase()) ?? false);
  const extensionAccepted = item.extension !== null && (input.extensions?.includes(item.extension.toLowerCase()) ?? false);
  return mimeAccepted || extensionAccepted;
}

function canContinueWith(
  manifest: ToolManifest,
  item: WorkspaceItem,
  kind: WorkspaceHandoffKind,
  count: number,
): boolean {
  if (manifest.slug === item.sourceTool) return false;
  if (!manifest.handoff.canReceive || !manifest.handoff.kinds.includes(kind)) return false;
  if (kind === "text") return manifest.inputs.some((input) => input.kind === "text");
  if (count > 1 && !manifest.supportsBatch) return false;
  return manifest.inputs.some((input) => acceptsFile(input, item, count));
}

/**
 * 回傳可接收這個 Workspace 項目的工具，來源工具的 suggestedNextTools 優先，
 * 其餘維持 manifest 順序，讓介面排序穩定。
 */
export function workspaceContinuationTargets(
  item: WorkspaceItem,
  items: readonly WorkspaceItem[],
): ToolManifest[] {
  const kind = workspaceHandoffKind(item);
  if (!kind) return [];
  const count = kind === "file" ? groupSize(item, items) : 1;
  const suggested = getToolManifest(item.sourceTool ?? "")?.suggestedNextTools ?? [];
  const priority = new Map(suggested.map((slug, index) => [slug, index]));

  return toolManifests
    .filter((manifest) => canContinueWith(manifest, item, kind, count))
    .sort((left, right) => {
      const leftPriority = priority.get(left.slug) ?? Number.MAX_SAFE_INTEGER;
      const rightPriority = priority.get(right.slug) ?? Number.MAX_SAFE_INTEGER;
      return leftPriority - rightPriority;
    });
}
