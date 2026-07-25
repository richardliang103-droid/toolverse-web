/**
 * IndexedDB 後端。只在瀏覽器執行（Node 沒有 IndexedDB，所以這個檔案不進單元測試）。
 *
 * 兩個 object store：
 * - `items`：metadata，永遠用這裡。
 * - `blobs`：Blob 的**退路**，OPFS 不能用時才會寫進來。
 *
 * 為什麼 metadata 不用 localStorage：Web Storage 是同步 API，資料一多就會卡住主
 * 執行緒。localStorage 在這個專案只放介面偏好那種小東西。
 */
import { migrateWorkspaceItems, sanitizeWorkspaceItem } from "./migration.ts";
import type { WorkspaceBlobBackend, WorkspaceItem, WorkspaceMetadataStore } from "./types.ts";

const DB_NAME = "toolverse-workspace";
const DB_VERSION = 1;
const ITEM_STORE = "items";
const BLOB_STORE = "blobs";

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 操作失敗"));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ITEM_STORE)) db.createObjectStore(ITEM_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("無法開啟工作區資料庫"));
    // 另一個分頁擋住升級時給明確錯誤，不要無聲卡住。
    request.onblocked = () => reject(new Error("另一個 ToolVerse 分頁正在使用工作區，請關掉其他分頁後重試。"));
  });
  return dbPromise;
}

/** 交易完成才算成功——`put` 的 request 成功不代表交易已經落地。 */
async function runWrite(storeName: string, action: (store: IDBObjectStore) => void): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("寫入工作區失敗"));
    transaction.onabort = () => reject(transaction.error ?? new Error("工作區寫入被中止"));
    action(transaction.objectStore(storeName));
  });
}

async function runRead<T>(storeName: string, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return promisify(action(db.transaction(storeName, "readonly").objectStore(storeName)));
}

export function createIndexedDbMetadataStore(): WorkspaceMetadataStore {
  return {
    async list(): Promise<WorkspaceItem[]> {
      // 資料庫裡的東西可能來自舊版本或被外力改過，一律先過 sanitize。
      return migrateWorkspaceItems(await runRead<unknown[]>(ITEM_STORE, (store) => store.getAll()));
    },
    async get(id) {
      const raw = await runRead<unknown>(ITEM_STORE, (store) => store.get(id));
      return raw === undefined ? null : sanitizeWorkspaceItem(raw);
    },
    async put(item) {
      await runWrite(ITEM_STORE, (store) => { store.put(item); });
    },
    async remove(id) {
      await runWrite(ITEM_STORE, (store) => { store.delete(id); });
    },
    async clear() {
      await runWrite(ITEM_STORE, (store) => { store.clear(); });
    },
  };
}

/** Blob 的退路後端。OPFS 不可用時才會被選中。 */
export function createIndexedDbBlobBackend(): WorkspaceBlobBackend {
  return {
    kind: "indexeddb",
    async write(key, blob) {
      await runWrite(BLOB_STORE, (store) => { store.put({ key, blob }); });
    },
    async read(key) {
      const record = await runRead<{ key: string; blob: Blob } | undefined>(BLOB_STORE, (store) => store.get(key));
      return record?.blob instanceof Blob ? record.blob : null;
    },
    async remove(key) {
      await runWrite(BLOB_STORE, (store) => { store.delete(key); });
    },
    async clear() {
      await runWrite(BLOB_STORE, (store) => { store.clear(); });
    },
  };
}
