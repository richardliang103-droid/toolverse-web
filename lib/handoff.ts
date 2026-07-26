/**
 * 工具接力：把某個工具的產出存進本機 Workspace，再把項目 id 放進目的地 URL。
 *
 * 接力不再依賴模組層的記憶體槽：硬重新整理、上一頁／下一頁與批次結果都走同一份
 * Workspace 資料。URL 只帶 UUID，Blob 與文字內容永遠留在瀏覽器儲存層。
 */
import { getToolManifest, toolsAcceptingHandoff } from "./tool-manifest.ts";
import { getWorkspaceRepository } from "./workspace/create.ts";
import type { WorkspaceItem } from "./workspace/types.ts";
import type { WorkspaceRepository } from "./workspace/repository.ts";

export type HandoffKind = "file" | "text";

export type Handoff =
  | {
      kind: "file";
      /** 單檔工具沿用 file；批次工具讀 files。 */
      file: File;
      files: File[];
      fromSlug: string;
      workspaceItemId: string;
      workspaceItemIds: string[];
    }
  | { kind: "text"; text: string; fromSlug: string; workspaceItemId: string };

type HandoffRepository = Pick<WorkspaceRepository, "save" | "get" | "list" | "read" | "readAsFile" | "remove" | "cleanup">;

const HANDOFF_KIND_KEY = "handoffKind";
const HANDOFF_GROUP_KEY = "handoffGroupId";
const HANDOFF_INDEX_KEY = "handoffIndex";
const HANDOFF_SOURCE_NAMES: Readonly<Record<string, string>> = {
  "smart-intake": "智慧入口",
  workspace: "工作區",
};

/** 同一個 URL token 在一個分頁內只消費一次；成功後 hook 也會把 query 移除。 */
const consumedWorkspaceItems = new Set<string>();

function repositoryOrDefault(repository?: HandoffRepository): Promise<HandoffRepository> {
  return repository ? Promise.resolve(repository) : getWorkspaceRepository();
}

function metadataString(item: WorkspaceItem, key: string): string | null {
  const value = item.metadata[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function metadataNumber(item: WorkspaceItem, key: string): number {
  const value = item.metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

/** 把工具 slug 或系統來源轉成使用者看得懂的名稱，避免顯示內部代稱。 */
export function handoffSourceName(slug: string): string {
  return getToolManifest(slug)?.name ?? HANDOFF_SOURCE_NAMES[slug] ?? "其他來源";
}

/** 把一個或多個結果存進 Workspace，回傳第一個項目 id 作為 URL token。 */
export async function putFileHandoff(
  input: File | readonly File[],
  fromSlug: string,
  repository?: HandoffRepository,
): Promise<string> {
  const files = input instanceof File ? [input] : [...input];
  if (files.length === 0) throw new Error("沒有可交接的檔案");

  const workspace = await repositoryOrDefault(repository);
  const groupId = crypto.randomUUID();
  const saved: WorkspaceItem[] = [];
  try {
    for (const [index, file] of files.entries()) {
      saved.push(await workspace.save({
        name: file.name,
        blob: file,
        mimeType: file.type || "application/octet-stream",
        sourceTool: fromSlug,
        metadata: {
          [HANDOFF_KIND_KEY]: "file",
          [HANDOFF_GROUP_KEY]: groupId,
          [HANDOFF_INDEX_KEY]: index,
        },
      }));
    }
  } catch (error) {
    await Promise.all(saved.map((item) => workspace.remove(item.id).catch(() => false)));
    throw error;
  }
  return saved[0].id;
}

/** 把文字存成 Workspace 項目，回傳 URL token。 */
export async function putTextHandoff(text: string, fromSlug: string, repository?: HandoffRepository): Promise<string> {
  const workspace = await repositoryOrDefault(repository);
  const item = await workspace.save({
    name: `${fromSlug}-handoff.txt`,
    blob: new Blob([text], { type: "text/plain" }),
    mimeType: "text/plain",
    sourceTool: fromSlug,
    metadata: { [HANDOFF_KIND_KEY]: "text" },
  });
  return item.id;
}

/**
 * 依 URL 裡的 Workspace item id 取出一次接力內容。
 *
 * 種類不符時不消費，讓錯誤的工具頁不會把接力內容吃掉。批次檔案會用同一個
 * handoffGroupId 找回整批項目，並依寫入順序還原。
 */
export async function takeHandoff(kind: HandoffKind, workspaceItemId: string | null | undefined, repository?: HandoffRepository): Promise<Handoff | null> {
  if (!workspaceItemId || consumedWorkspaceItems.has(workspaceItemId)) return null;
  const workspace = await repositoryOrDefault(repository);
  // 由 repository 使用它自己的 clock 清理，測試與瀏覽器都不會因為兩個時鐘來源
  // 不一致而把剛存入的接力誤判成過期。
  await workspace.cleanup().catch(() => {});
  const item = await workspace.get(workspaceItemId);
  if (!item || metadataString(item, HANDOFF_KIND_KEY) !== kind) return null;

  if (kind === "text") {
    const blob = await workspace.read(item.id);
    if (!blob) return null;
    return { kind: "text", text: await blob.text(), fromSlug: item.sourceTool ?? "workspace", workspaceItemId: item.id };
  }

  const groupId = metadataString(item, HANDOFF_GROUP_KEY);
  const group = groupId
    ? (await workspace.list())
      .filter((candidate) => metadataString(candidate, HANDOFF_KIND_KEY) === "file" && metadataString(candidate, HANDOFF_GROUP_KEY) === groupId)
      .sort((left, right) => metadataNumber(left, HANDOFF_INDEX_KEY) - metadataNumber(right, HANDOFF_INDEX_KEY))
    : [item];
  const files: File[] = [];
  for (const candidate of group) {
    const file = await workspace.readAsFile(candidate.id);
    if (!file) return null;
    files.push(file);
  }
  if (files.length === 0) return null;
  return {
    kind: "file",
    file: files[0],
    files,
    fromSlug: item.sourceTool ?? "workspace",
    workspaceItemId: item.id,
    workspaceItemIds: group.map((candidate) => candidate.id),
  };
}

/** 使用者確認帶入後呼叫；確認前保留 token，離開頁面後仍可重新檢查。 */
export function consumeHandoff(handoff: Handoff): void {
  if (handoff.kind === "text") consumedWorkspaceItems.add(handoff.workspaceItemId);
  else for (const id of handoff.workspaceItemIds) consumedWorkspaceItems.add(id);
}

/** 接力目標由 manifest 的實際 canReceive 狀態推導，不再維護手寫白名單。 */
export const IMAGE_TOOL_SLUGS = toolsAcceptingHandoff("file").map((manifest) => manifest.slug);
export const TEXT_TOOL_SLUGS = toolsAcceptingHandoff("text").map((manifest) => manifest.slug);

export type ImageToolSlug = (typeof IMAGE_TOOL_SLUGS)[number];
export type TextToolSlug = (typeof TEXT_TOOL_SLUGS)[number];

/** 把 Blob 包成帶檔名的 File，接收端的副檔名檢查才會過。 */
export function toHandoffFile(blob: Blob, name: string): File {
  return new File([blob], name, { type: blob.type || "application/octet-stream" });
}

/** 批次工具的入口收 FileList；把單一交接檔包成 FileList 就能沿用原本的載入路徑。 */
export function fileListOf(file: File): FileList {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  return transfer.files;
}
