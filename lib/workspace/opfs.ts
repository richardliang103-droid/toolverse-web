/**
 * OPFS（Origin Private File System）後端。只在瀏覽器執行。
 *
 * OPFS 是瀏覽器給每個 origin 的私有檔案空間，存大型 Blob 比 IndexedDB 有效率。
 * 但它的支援度不齊：`createWritable()` 進 Safari 的時間比其他瀏覽器晚很多，
 * 有些環境（無痕模式、被鎖住的儲存權限）連 `getDirectory()` 都會丟例外。
 *
 * 所以這裡**實際試寫一次**再決定能不能用，而不是只看 API 存不存在——
 * 「偵測得到」跟「真的能寫」在 OPFS 上不是同一件事。偵測失敗就回 null，
 * 呼叫端會改用 IndexedDB。
 */
import type { WorkspaceBlobBackend } from "./types.ts";

const DIRECTORY = "workspace";
const PROBE_KEY = ".toolverse-probe";

async function writeFile(directory: FileSystemDirectoryHandle, key: string, blob: Blob): Promise<void> {
  const handle = await directory.getFileHandle(key, { create: true });
  // createWritable 在舊版 Safari 不存在（那邊只有 worker 裡的 createSyncAccessHandle）。
  // 這裡是主執行緒，缺了就代表這個瀏覽器走不了 OPFS 這條路。
  if (typeof handle.createWritable !== "function") throw new Error("這個瀏覽器不支援 OPFS 寫入");
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}

/**
 * 建立 OPFS 後端；這個瀏覽器用不了就回 null。
 *
 * 探測會真的寫一個小檔再刪掉，確認 `getFileHandle` ＋ `createWritable` ＋ `removeEntry`
 * 三個都能用。只做一次，結果由呼叫端快取。
 */
export async function createOpfsBackend(): Promise<WorkspaceBlobBackend | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return null;

  let root: FileSystemDirectoryHandle;
  try {
    root = await navigator.storage.getDirectory();
  } catch {
    return null;
  }

  // 目錄句柄快取起來，但 clear() 會把整個目錄砍掉，所以要能重新取得。
  let directory: FileSystemDirectoryHandle | null = null;
  const openDirectory = async (): Promise<FileSystemDirectoryHandle> => {
    directory ??= await root.getDirectoryHandle(DIRECTORY, { create: true });
    return directory;
  };

  try {
    const probeDirectory = await openDirectory();
    await writeFile(probeDirectory, PROBE_KEY, new Blob([new Uint8Array([1])]));
    await probeDirectory.removeEntry(PROBE_KEY);
  } catch {
    return null;
  }

  return {
    kind: "opfs",
    async write(key, blob) {
      await writeFile(await openDirectory(), key, blob);
    },
    async read(key) {
      try {
        const handle = await (await openDirectory()).getFileHandle(key);
        return await handle.getFile();
      } catch {
        // 檔案不在（NotFoundError）對呼叫端來說就是「讀不到」，不算錯誤。
        return null;
      }
    },
    async remove(key) {
      try {
        await (await openDirectory()).removeEntry(key);
      } catch {
        // 已經不見了就當作刪成功。
      }
    },
    async clear() {
      // 整個目錄遞迴砍掉再讓下次重建，比逐一列舉刪除單純，也不必用到
      // TypeScript DOM 型別還沒收錄的 `FileSystemDirectoryHandle.keys()`。
      try {
        await root.removeEntry(DIRECTORY, { recursive: true });
      } catch {
        // 目錄本來就不在也算清乾淨了。
      }
      directory = null;
    },
  };
}
