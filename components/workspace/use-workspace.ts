"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { downloadBlob } from "@/lib/download";
import type { PersonalToolsState } from "@/lib/personal-tools";
import { tools } from "@/lib/tools";
import { getWorkspaceRepository } from "@/lib/workspace/create";
import { WorkspaceQuotaError, type WorkspaceItem, type WorkspaceStorageBackend, type WorkspaceUsage } from "@/lib/workspace/types";

export type WorkspaceNotice = { kind: "info" | "error"; text: string };
const VALID_TOOL_SLUGS = tools.map((tool) => tool.slug);

/**
 * `/workspace` 的狀態與動作。
 *
 * 工作區頁面與首頁摘要共用這個 hook。兩者是不同路由、不會同時掛載，因此不需要
 * 為了共用程式碼再加一層全站 context。
 */
export function useWorkspace() {
  const [items, setItems] = useState<WorkspaceItem[]>([]);
  const [usage, setUsage] = useState<WorkspaceUsage | null>(null);
  const [backend, setBackend] = useState<WorkspaceStorageBackend | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<WorkspaceNotice | null>(null);

  // 每次重新讀取都拿一個號碼；回來時號碼不是最新的就丟掉結果，
  // 避免慢的那次覆蓋掉使用者剛做完的動作（catch 分支也要檢查）。
  const syncRef = useRef(0);
  const mountedRef = useRef(true);
  // 擋重複點擊用 ref 而不是 busy state：state 要等下一次 render 才更新，
  // 連點兩下時第二次讀到的還是舊值，會兩個動作一起跑。
  const busyRef = useRef(false);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const refresh = useCallback(async () => {
    const id = (syncRef.current += 1);
    try {
      const repository = await getWorkspaceRepository();
      const [nextItems, nextUsage] = await Promise.all([repository.list(), repository.usage()]);
      if (!mountedRef.current || id !== syncRef.current) return;
      setItems(nextItems);
      setUsage(nextUsage);
      setBackend(repository.backendKind);
    } catch {
      if (!mountedRef.current || id !== syncRef.current) return;
      setNotice({ kind: "error", text: "讀不到工作區。若你正在使用無痕模式或封鎖了網站儲存空間，工作區無法運作。" });
    } finally {
      if (mountedRef.current && id === syncRef.current) setReady(true);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      // 每次進頁面先清掉過期的暫存項目。pinned 的項目不受影響。
      try {
        const repository = await getWorkspaceRepository();
        await repository.cleanup();
      } catch {
        // 清理失敗不該讓頁面打不開，接著照常載入清單。
      }
      await refresh();
    })();
  }, [refresh]);

  /** 包住會改動資料的動作：統一擋重複點擊、統一把錯誤翻成看得懂的訊息。 */
  const run = useCallback(async (action: () => Promise<WorkspaceNotice | null>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const result = await action();
      await refresh();
      if (mountedRef.current && result) setNotice(result);
    } catch (error) {
      if (!mountedRef.current) return;
      setNotice({
        kind: "error",
        text: error instanceof WorkspaceQuotaError || (error instanceof Error && error.name === "PersonalBackupError")
          ? error.message
          : "操作失敗，請重試。",
      });
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, [refresh]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const incoming = [...files];
    if (incoming.length === 0) return;
    await run(async () => {
      const repository = await getWorkspaceRepository();
      // 一個一個存：中途空間不足時，前面成功的要留著，而不是整批消失。
      let saved = 0;
      try {
        for (const file of incoming) {
          await repository.save({ name: file.name, blob: file, mimeType: file.type });
          saved += 1;
        }
      } catch (error) {
        if (saved > 0 && error instanceof WorkspaceQuotaError) {
          throw new WorkspaceQuotaError(`已存入 ${saved} 個檔案後空間不足，其餘未加入。請先刪除不需要的項目。`);
        }
        throw error;
      }
      return { kind: "info", text: `已加入 ${saved} 個檔案。` };
    });
  }, [run]);

  const remove = useCallback(async (id: string) => {
    await run(async () => {
      const repository = await getWorkspaceRepository();
      await repository.remove(id);
      return { kind: "info", text: "已刪除，檔案內容也一併清除。" };
    });
  }, [run]);

  const togglePinned = useCallback(async (id: string, pinned: boolean) => {
    await run(async () => {
      const repository = await getWorkspaceRepository();
      await repository.setPinned(id, pinned);
      return { kind: "info", text: pinned ? "已標記保留，自動清理不會刪除它。" : "已取消保留，24 小時後會自動清除。" };
    });
  }, [run]);

  const clearAll = useCallback(async () => {
    await run(async () => {
      const repository = await getWorkspaceRepository();
      await repository.clear();
      return { kind: "info", text: "工作區已清空。" };
    });
  }, [run]);

  const download = useCallback(async (item: WorkspaceItem) => {
    await run(async () => {
      const repository = await getWorkspaceRepository();
      const blob = await repository.read(item.id);
      if (!blob) return { kind: "error", text: "找不到這個項目的檔案內容，可能已被瀏覽器清除。" };
      downloadBlob(blob, item.name);
      return null;
    });
  }, [run]);

  const exportBackup = useCallback(async (personalTools: PersonalToolsState) => {
    await run(async () => {
      // fflate 只在使用者真的按下備份時才載入，不增加首頁的初始 bundle。
      const {
        collectPersonalBackupSources,
        createPersonalBackupArchive,
        personalBackupFileName,
      } = await import("@/lib/personal-backup");
      const repository = await getWorkspaceRepository();
      const sources = await collectPersonalBackupSources(repository);
      const now = new Date();
      const archive = await createPersonalBackupArchive(personalTools, sources, VALID_TOOL_SLUGS, now);
      downloadBlob(archive, personalBackupFileName(now));
      return { kind: "info", text: `備份已建立：${sources.length} 個工作區項目與個人設定。` };
    });
  }, [run]);

  const importBackup = useCallback(async (
    archive: File,
    onPersonalTools: (state: PersonalToolsState) => void,
  ) => {
    await run(async () => {
      const { readPersonalBackupArchive, restorePersonalBackupWorkspace } = await import("@/lib/personal-backup");
      const backup = await readPersonalBackupArchive(archive, VALID_TOOL_SLUGS);
      const repository = await getWorkspaceRepository();
      await restorePersonalBackupWorkspace(repository, backup.workspace);
      onPersonalTools(backup.personalTools);
      return {
        kind: "info",
        text: `已合併匯入 ${backup.workspace.length} 個工作區項目；收藏與最近使用設定也已更新。`,
      };
    });
  }, [run]);

  return {
    items,
    usage,
    backend,
    ready,
    busy,
    notice,
    addFiles,
    remove,
    togglePinned,
    clearAll,
    download,
    exportBackup,
    importBackup,
    setNotice,
  };
}
