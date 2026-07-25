/**
 * 挑後端、組出 repository。只在瀏覽器呼叫。
 *
 * 選擇順序：OPFS（大檔案比較有效率）→ IndexedDB（退路）。兩個都會登記成可讀後端，
 * 這樣「上次用 OPFS 存、這次 OPFS 探測失敗」的舊項目仍然讀得到。
 */
import { createIndexedDbBlobBackend, createIndexedDbMetadataStore } from "./indexed-db.ts";
import { createOpfsBackend } from "./opfs.ts";
import { WorkspaceRepository } from "./repository.ts";

let repositoryPromise: Promise<WorkspaceRepository> | null = null;

async function build(): Promise<WorkspaceRepository> {
  const indexedDbBlobs = createIndexedDbBlobBackend();
  const opfsBlobs = await createOpfsBackend();
  return new WorkspaceRepository({
    metadata: createIndexedDbMetadataStore(),
    blobs: opfsBlobs ?? indexedDbBlobs,
    readBackends: opfsBlobs ? [indexedDbBlobs] : [],
    estimate: navigator.storage?.estimate ? () => navigator.storage.estimate() : undefined,
  });
}

/** 整個分頁共用一個 repository：OPFS 探測與資料庫連線只做一次。 */
export function getWorkspaceRepository(): Promise<WorkspaceRepository> {
  repositoryPromise ??= build();
  return repositoryPromise;
}
