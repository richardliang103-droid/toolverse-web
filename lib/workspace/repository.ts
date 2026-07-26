/**
 * 工作區的組合層：metadata 與 Blob 分兩個後端存，這裡負責讓它們保持一致。
 *
 * 後端是注入進來的，所以這個檔案在 Node 裡也測得到（IndexedDB 與 OPFS 在 Node
 * 都不存在）。`tests/workspace.test.mjs` 用記憶體版後端驗證所有一致性規則。
 */
import { checksumOf } from "./hash.ts";
import { selectExpired, sortByNewest, summarize, temporaryExpiry } from "./cleanup.ts";
import { splitFileName, storageKeyFor, uniqueFileName } from "./naming.ts";
import {
  TEMPORARY_TTL_MS,
  WORKSPACE_SCHEMA_VERSION,
  WorkspaceQuotaError,
  isQuotaError,
  type WorkspaceBlobBackend,
  type WorkspaceItem,
  type WorkspaceMetadataStore,
  type WorkspaceUsage,
} from "./types.ts";

export interface WorkspaceSaveInput {
  name: string;
  blob: Blob;
  /** 沒給就用 `blob.type`，再沒有就當成未知的二進位檔。 */
  mimeType?: string;
  /** 產生這個項目的工具 slug。使用者自己拖進來的留空。 */
  sourceTool?: string | null;
  parentItemIds?: string[];
  metadata?: Record<string, unknown>;
  /** 使用者明確要求保留，不受自動清理影響。 */
  pinned?: boolean;
  /** 備份還原時保留原始建立時間；一般儲存不需提供。 */
  createdAt?: string;
}

export interface WorkspaceRepositoryDeps {
  metadata: WorkspaceMetadataStore;
  /** 寫入用的主要後端。 */
  blobs: WorkspaceBlobBackend;
  /**
   * 其他還讀得到的後端。
   *
   * 用途是「上次用 OPFS 存的，這次 OPFS 探測失敗改用 IndexedDB」——metadata 記著
   * 每個項目當初存在哪，讀的時候照著找，舊項目才不會憑空變成讀不到。
   */
  readBackends?: WorkspaceBlobBackend[];
  now?: () => number;
  ttlMs?: number;
  createId?: () => string;
  /** 包一層 `navigator.storage.estimate()`，注入才能測。 */
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
}

/** 把底層的 DOMException 換成看得懂的錯誤，其餘原樣往上丟。 */
function toWorkspaceError(error: unknown): unknown {
  return isQuotaError(error) ? new WorkspaceQuotaError() : error;
}

export class WorkspaceRepository {
  readonly backendKind: WorkspaceBlobBackend["kind"];

  #metadata: WorkspaceMetadataStore;
  #blobs: WorkspaceBlobBackend;
  #readBackends: Map<WorkspaceBlobBackend["kind"], WorkspaceBlobBackend>;
  #now: () => number;
  #ttlMs: number;
  #createId: () => string;
  #estimate: (() => Promise<{ usage?: number; quota?: number }>) | null;

  constructor(deps: WorkspaceRepositoryDeps) {
    this.#metadata = deps.metadata;
    this.#blobs = deps.blobs;
    // 主要後端最後放，重複的 kind 由它勝出。
    this.#readBackends = new Map<WorkspaceBlobBackend["kind"], WorkspaceBlobBackend>();
    for (const backend of [...(deps.readBackends ?? []), deps.blobs]) this.#readBackends.set(backend.kind, backend);
    this.#now = deps.now ?? (() => Date.now());
    this.#ttlMs = deps.ttlMs ?? TEMPORARY_TTL_MS;
    this.#createId = deps.createId ?? (() => crypto.randomUUID());
    this.#estimate = deps.estimate ?? null;
    this.backendKind = deps.blobs.kind;
  }

  /** 全部項目，新到舊。 */
  async list(): Promise<WorkspaceItem[]> {
    return sortByNewest(await this.#metadata.list());
  }

  async get(id: string): Promise<WorkspaceItem | null> {
    return this.#metadata.get(id);
  }

  /**
   * 存進工作區。
   *
   * 順序是刻意的：**先寫 Blob，成功了才寫 metadata**。反過來的話，Blob 寫失敗
   * （最常見的原因就是空間不足）會在清單裡留下一個點不開的項目。metadata 寫失敗
   * 時則把剛寫進去的 Blob 收回來，不留孤兒佔用空間。
   */
  async save(input: WorkspaceSaveInput): Promise<WorkspaceItem> {
    const nowMs = this.#now();
    const existing = await this.#metadata.list();
    const name = uniqueFileName(existing.map((item) => item.name), input.name);
    const { extension } = splitFileName(name);
    const id = this.#createId();
    const storageKey = storageKeyFor(id, extension);
    const pinned = input.pinned === true;
    const checksumSha256 = await checksumOf(input.blob);

    try {
      await this.#blobs.write(storageKey, input.blob);
    } catch (error) {
      throw toWorkspaceError(error);
    }

    const importedCreatedAt = typeof input.createdAt === "string" ? Date.parse(input.createdAt) : Number.NaN;
    const timestamp = Number.isFinite(importedCreatedAt)
      ? new Date(importedCreatedAt).toISOString()
      : new Date(nowMs).toISOString();
    const updatedAt = new Date(nowMs).toISOString();
    const item: WorkspaceItem = {
      id,
      name,
      mimeType: input.mimeType || input.blob.type || "application/octet-stream",
      extension,
      sizeBytes: input.blob.size,
      sourceTool: input.sourceTool ?? null,
      createdAt: timestamp,
      updatedAt,
      expiresAt: pinned ? null : temporaryExpiry(nowMs, this.#ttlMs),
      pinned,
      storageBackend: this.#blobs.kind,
      storageKey,
      checksumSha256,
      parentItemIds: input.parentItemIds ?? [],
      metadata: input.metadata ?? {},
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
    };

    try {
      await this.#metadata.put(item);
    } catch (error) {
      await this.#blobs.remove(storageKey).catch(() => {});
      throw toWorkspaceError(error);
    }
    return item;
  }

  /** 照 metadata 記錄的後端去找；那個後端這次用不了就退回主要後端。 */
  #backendFor(item: WorkspaceItem): WorkspaceBlobBackend {
    return this.#readBackends.get(item.storageBackend) ?? this.#blobs;
  }

  /** 讀回原始 Blob；項目不存在或 Blob 已經不見時回 null。 */
  async read(id: string): Promise<Blob | null> {
    const item = await this.#metadata.get(id);
    if (!item) return null;
    return this.#backendFor(item).read(item.storageKey);
  }

  /** 讀成帶檔名的 File，下載與之後的工具接力都要用到檔名。 */
  async readAsFile(id: string): Promise<File | null> {
    const item = await this.#metadata.get(id);
    if (!item) return null;
    const blob = await this.#backendFor(item).read(item.storageKey);
    return blob ? new File([blob], item.name, { type: item.mimeType }) : null;
  }

  /**
   * 刪除項目。
   *
   * 先刪 Blob 再刪 metadata，而且 Blob 刪失敗也要繼續走完：使用者按下刪除，
   * 要的是「清單上不見」。萬一真的留下孤兒 Blob，`clear()` 會整個清掉。
   */
  async remove(id: string): Promise<boolean> {
    const item = await this.#metadata.get(id);
    if (!item) return false;
    await this.#backendFor(item).remove(item.storageKey).catch(() => {});
    await this.#metadata.remove(id);
    return true;
  }

  /** 切換保留狀態。取消保留時要重新給一個到期時間，否則它會永遠留著。 */
  async setPinned(id: string, pinned: boolean): Promise<WorkspaceItem | null> {
    const item = await this.#metadata.get(id);
    if (!item) return null;
    const nowMs = this.#now();
    const updated: WorkspaceItem = {
      ...item,
      pinned,
      expiresAt: pinned ? null : temporaryExpiry(nowMs, this.#ttlMs),
      updatedAt: new Date(nowMs).toISOString(),
    };
    await this.#metadata.put(updated);
    return updated;
  }

  /** 清空整個工作區，包含任何殘留的孤兒 Blob。所有後端都要清，不只目前在用的那個。 */
  async clear(): Promise<void> {
    for (const backend of this.#readBackends.values()) await backend.clear().catch(() => {});
    await this.#metadata.clear();
  }

  /**
   * 清掉過期的暫存項目，回傳刪除筆數。
   *
   * pinned 的項目永遠不在名單裡——見 `selectExpired()`。
   */
  async cleanup(): Promise<number> {
    const expired = selectExpired(await this.#metadata.list(), this.#now());
    for (const item of expired) await this.remove(item.id);
    return expired.length;
  }

  /** 內容相同的其他項目，供介面提示重複。 */
  async findByChecksum(checksum: string, excludeId?: string): Promise<WorkspaceItem[]> {
    const items = await this.#metadata.list();
    return items.filter((item) => item.checksumSha256 === checksum && item.id !== excludeId);
  }

  /** 目前用量。瀏覽器的配額估算取不到時，兩個欄位是 null，介面就只顯示項目大小總和。 */
  async usage(): Promise<WorkspaceUsage> {
    const items = await this.#metadata.list();
    const { count, pinnedCount, totalBytes } = summarize(items);
    let quotaBytes: number | null = null;
    let originUsageBytes: number | null = null;
    if (this.#estimate) {
      try {
        const estimate = await this.#estimate();
        quotaBytes = typeof estimate.quota === "number" ? estimate.quota : null;
        originUsageBytes = typeof estimate.usage === "number" ? estimate.usage : null;
      } catch {
        // 估算失敗不該讓整個工作區頁面壞掉，維持 null 就好。
      }
    }
    return { count, pinnedCount, totalBytes, quotaBytes, originUsageBytes };
  }
}
