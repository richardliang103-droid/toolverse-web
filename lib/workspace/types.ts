/**
 * 本機工作區的資料模型與儲存介面。
 *
 * 工作區解決的是「下載 → 找檔案 → 重新上傳」這段來回：處理結果先留在瀏覽器裡，
 * 之後可以下載、刪除，或（PR 4 之後）直接遞給下一個工具。
 *
 * 三個地方各司其職，介面在這裡定義、實作分在別的檔案，這樣 `repository.ts`
 * 才能在 Node 裡用假的後端跑測試（IndexedDB 與 OPFS 在 Node 都不存在）：
 * - metadata（小、要查詢）→ IndexedDB
 * - Blob（大）→ 優先 OPFS，不支援時退回 IndexedDB
 * - 介面偏好（Favorite、主題）→ localStorage，**不放檔案**
 */

/** metadata 記錄的結構版本。改欄位就要 +1，並在 `migration.ts` 補上遷移。 */
export const WORKSPACE_SCHEMA_VERSION = 1;

/**
 * 暫存項目的存活時間：24 小時。
 *
 * 工具接力自動存進來的東西不該永久佔用使用者的磁碟，但也不能短到「泡杯咖啡回來
 * 就沒了」。使用者按下「保留」（pinned）的項目不受這個時間影響。
 */
export const TEMPORARY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 超過這個大小就不算 checksum。
 *
 * SHA-256 要把整個檔案讀進來跑一遍，150 MB 的合併 PDF 這樣做會讓主執行緒卡住。
 * checksum 只是用來提示「這份跟工作區裡某一份內容相同」，不值得為它卡畫面。
 */
export const CHECKSUM_MAX_BYTES = 16 * 1024 * 1024;

export type WorkspaceStorageBackend = "opfs" | "indexeddb";

export interface WorkspaceItem {
  id: string;
  /** 顯示與下載用的檔名。同名不會互相覆蓋，寫入時會自動加序號。 */
  name: string;
  mimeType: string;
  /** 含點，例如 `.png`；沒有副檔名時是 null。 */
  extension: string | null;
  sizeBytes: number;

  /** 產生這個項目的工具 slug；使用者自己拖進來的是 null。 */
  sourceTool: string | null;
  createdAt: string;
  updatedAt: string;
  /** 自動清除時間；null 代表不自動清除（pinned 的項目一定是 null）。 */
  expiresAt: string | null;
  /** 使用者明確要求保留。自動清理絕不動這些項目。 */
  pinned: boolean;

  storageBackend: WorkspaceStorageBackend;
  storageKey: string;

  /** 檔案過大時（見 `CHECKSUM_MAX_BYTES`）不計算，會是 undefined。 */
  checksumSha256?: string;
  /** 這個項目是從哪些項目處理出來的，供之後追溯工作流程。 */
  parentItemIds: string[];

  metadata: Record<string, unknown>;
  schemaVersion: number;
}

/** 大型 Blob 的儲存後端。OPFS 與 IndexedDB 各有一份實作。 */
export interface WorkspaceBlobBackend {
  readonly kind: WorkspaceStorageBackend;
  write(key: string, blob: Blob): Promise<void>;
  read(key: string): Promise<Blob | null>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

/** metadata 的儲存後端。 */
export interface WorkspaceMetadataStore {
  list(): Promise<WorkspaceItem[]>;
  get(id: string): Promise<WorkspaceItem | null>;
  put(item: WorkspaceItem): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface WorkspaceUsage {
  count: number;
  pinnedCount: number;
  totalBytes: number;
  /** `navigator.storage.estimate()` 的結果；取不到時是 null。 */
  quotaBytes: number | null;
  originUsageBytes: number | null;
}

/**
 * 瀏覽器空間不足。
 *
 * 分成獨立的錯誤型別，是為了讓 UI 能給出「該怎麼辦」的訊息——泛用的
 * DOMException 訊息是英文的，而且對使用者沒有任何指示。
 */
export class WorkspaceQuotaError extends Error {
  constructor(message = "瀏覽器的儲存空間不足，請先刪除工作區裡不需要的項目，或改用直接下載。") {
    super(message);
    this.name = "WorkspaceQuotaError";
  }
}

/** 判斷底層丟出來的是不是配額問題。各家瀏覽器的表現方式不一致，所以三種都認。 */
export function isQuotaError(error: unknown): boolean {
  if (error instanceof WorkspaceQuotaError) return true;
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED";
  }
  return error instanceof Error && /quota|storage is full/i.test(error.message);
}
