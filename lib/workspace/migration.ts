/**
 * metadata 的逐欄驗證與版本遷移。
 *
 * IndexedDB 裡的東西可能來自：舊版本的網站、被開發者工具改過的記錄、寫到一半斷電的
 * 交易。這些都不能直接信任——一筆壞記錄不該讓整個工作區打不開，所以驗證失敗就丟掉
 * 那一筆，其餘照常載入。
 *
 * 遵循 repo 既有慣例（見 lottery 的 migrateLegacyWinnerNames）：sanitize 函式逐欄
 * 檢查，schema 改欄位就寫一次性遷移。
 */
import { temporaryExpiry } from "./cleanup.ts";
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceItem, type WorkspaceStorageBackend } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function asIsoDate(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function asBackend(value: unknown): WorkspaceStorageBackend | null {
  return value === "opfs" || value === "indexeddb" ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

function resolveExpiry(raw: unknown, createdAt: string): string {
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return temporaryExpiry(Date.parse(createdAt));
}

/**
 * 把一筆原始記錄驗成 `WorkspaceItem`，驗不過回 null。
 *
 * id、storageKey、sizeBytes 是硬性要求：少了它們就找不到、也讀不出對應的 Blob，
 * 留著只會在清單裡變成一個點不開的殭屍項目。
 */
export function sanitizeWorkspaceItem(raw: unknown, nowMs: number = Date.now()): WorkspaceItem | null {
  if (!isRecord(raw)) return null;

  const id = asNonEmptyString(raw.id);
  const storageKey = asNonEmptyString(raw.storageKey);
  const storageBackend = asBackend(raw.storageBackend);
  const sizeBytes = typeof raw.sizeBytes === "number" && Number.isFinite(raw.sizeBytes) && raw.sizeBytes >= 0 ? raw.sizeBytes : null;
  if (!id || !storageKey || !storageBackend || sizeBytes === null) return null;

  const fallbackDate = new Date(nowMs).toISOString();
  const createdAt = asIsoDate(raw.createdAt, fallbackDate);
  const pinned = raw.pinned === true;

  // 不變條件：pinned 的項目沒有到期時間，沒 pin 的一定有。
  //
  // v0 的記錄沒有 expiresAt 欄位，要補一個；補的時候從它自己的 createdAt 起算，
  // 而不是從「這次載入」起算——否則每次開網頁都會把到期時間往後推，永遠清不掉。
  const expiresAt = pinned ? null : resolveExpiry(raw.expiresAt, createdAt);

  return {
    id,
    name: asNonEmptyString(raw.name) ?? "未命名檔案",
    mimeType: asNonEmptyString(raw.mimeType) ?? "application/octet-stream",
    extension: asNonEmptyString(raw.extension),
    sizeBytes,
    sourceTool: asNonEmptyString(raw.sourceTool),
    createdAt,
    updatedAt: asIsoDate(raw.updatedAt, createdAt),
    expiresAt,
    pinned,
    storageBackend,
    storageKey,
    checksumSha256: asNonEmptyString(raw.checksumSha256) ?? undefined,
    parentItemIds: asStringArray(raw.parentItemIds),
    metadata: isRecord(raw.metadata) ? raw.metadata : {},
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
  };
}

/** 批次驗證，壞掉的記錄直接略過。回傳的順序與輸入相同。 */
export function migrateWorkspaceItems(raw: readonly unknown[], nowMs: number = Date.now()): WorkspaceItem[] {
  const items: WorkspaceItem[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const item = sanitizeWorkspaceItem(entry, nowMs);
    // 同一個 id 出現兩次代表資料庫被外力改過；留第一筆就好，兩筆都留會讓刪除行為變得
    // 不可預測（刪掉一筆，清單裡還有一筆指向同一個已消失的 Blob）。
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return items;
}
