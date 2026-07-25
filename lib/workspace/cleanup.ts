/**
 * 自動清理政策。純函式，方便單獨驗證「什麼會被刪、什麼絕對不會」。
 *
 * 工作區有兩種項目：
 * - **暫存**：工具接力自動存進來的，過了 TTL 就清掉，不必使用者管理。
 * - **保留**（pinned）：使用者明確按過「保留」。**自動清理絕不動它們。**
 *
 * 這條界線是刻意的：無提示刪除使用者明確標記要留的東西，比留著垃圾嚴重得多。
 */
import { TEMPORARY_TTL_MS, type WorkspaceItem } from "./types.ts";

/** 暫存項目的到期時間。 */
export function temporaryExpiry(nowMs: number, ttlMs: number = TEMPORARY_TTL_MS): string {
  return new Date(nowMs + ttlMs).toISOString();
}

/** 算出到期時間。pinned 一律回 null（不過期）。 */
export function expiryFor(pinned: boolean, nowMs: number, ttlMs: number = TEMPORARY_TTL_MS): string | null {
  return pinned ? null : temporaryExpiry(nowMs, ttlMs);
}

/**
 * 挑出該清掉的項目。
 *
 * 三重保險，因為誤刪是不可逆的：pinned 直接跳過、沒有 expiresAt 的跳過、
 * 時間解析不出來的也跳過（壞掉的日期字串不該變成「立刻刪除」）。
 */
export function selectExpired(items: readonly WorkspaceItem[], nowMs: number): WorkspaceItem[] {
  return items.filter((item) => {
    if (item.pinned) return false;
    if (!item.expiresAt) return false;
    const expiry = Date.parse(item.expiresAt);
    if (!Number.isFinite(expiry)) return false;
    return expiry <= nowMs;
  });
}

/** 工作區摘要，給 `/workspace` 與首頁的摘要區塊用。 */
export function summarize(items: readonly WorkspaceItem[]): { count: number; pinnedCount: number; totalBytes: number } {
  let pinnedCount = 0;
  let totalBytes = 0;
  for (const item of items) {
    if (item.pinned) pinnedCount += 1;
    totalBytes += Number.isFinite(item.sizeBytes) && item.sizeBytes > 0 ? item.sizeBytes : 0;
  }
  return { count: items.length, pinnedCount, totalBytes };
}

/** 新到舊。清單一律這樣排——剛做完的東西最可能是使用者要找的。 */
export function sortByNewest(items: readonly WorkspaceItem[]): WorkspaceItem[] {
  return [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
