"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  advanceStateRevision,
  candidatePool,
  canDeleteParticipant,
  canDeletePrize,
  canDeleteRoster,
  createEmptyEventState,
  createParticipant,
  createPrize,
  createRoster,
  csvRowsToDownloadText,
  disqualifyWinner,
  eventBackupFileName,
  exportEventBackup,
  findDuplicateEmployeeId,
  findNextDrawablePrize,
  formatLotteryTimestamp,
  MAX_DRAW_COUNT_PER_ROUND,
  MAX_IMAGE_DATA_URL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_PARTICIPANTS,
  MAX_PRIZES,
  MAX_ROSTERS,
  mergeParticipantsFromCsv,
  parseEventBackup,
  parseParticipantsCsv,
  parsePrizesCsv,
  pendingRevealCompleteAt,
  remainingSlots,
  resetEventDraws,
  stagePreviewCompleteAt,
  totalParticipantCount,
  winnersToCsv,
  type EventParticipant,
  type EventPrize,
  type LotteryEventState,
} from "@/lib/event-lottery";
import { downloadBlob } from "@/lib/download";
import {
  buildPairingUrl,
  EVENT_LOTTERY_REMOTE_STORAGE_KEY,
  EVENT_LOTTERY_REMOTE_PAIRING_TOKEN_KEY,
  generatePairingToken,
  isRemoteSessionUsable,
  sanitizeStoredRemoteSessionPointer,
  type StoredRemoteSessionPointer,
} from "@/lib/event-lottery-remote";
import { connectRemoteChannel, ensureAnonymousSession, type RemoteChannelHandle } from "@/lib/event-lottery-remote-channel";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase-browser";
import { decodeTextBytes, encodingLabel, type DetectedTextEncoding, type TextEncodingPreference } from "@/lib/text-encoding";
import { clearStageAction, prepareStage, previewPrizeWinnersAction, startDraw } from "./actions";
import { loadEventState, saveEventState, useEventLotterySync, type EventLotterySyncMessage } from "./sync";

type Notice = { text: string; tone: "info" | "error" };

/** 舞台沒有回報 DRAW_FINISHED（例如舞台分頁根本沒開）時，控制台最多等理論播完
 *  時間之後再加這麼多毫秒就自動解鎖，避免永久鎖死。 */
const DRAW_LOCK_FALLBACK_MARGIN_MS = 8000;

/** 參加者表格一次只渲染一頁：全量名單上限 5000 人，整表塞進一頁會讓畫面過長
 *  也拖慢渲染，分頁同時解決版面與效能問題。 */
const PARTICIPANT_PAGE_SIZE = 50;

/** 控制台分頁狀態存進 localStorage，重新整理後停留在原本查看的分頁。 */
const CONSOLE_TAB_STORAGE_KEY = "toolverse:event-lottery:console-tab:v1";

type TabId = "settings" | "roster" | "prizes" | "draw" | "history";
const TABS: Array<{ id: TabId; label: string }> = [
  { id: "settings", label: "活動設定" },
  { id: "roster", label: "名單與參加者" },
  { id: "prizes", label: "獎項管理" },
  { id: "draw", label: "抽獎控制" },
  { id: "history", label: "得獎紀錄" },
];

/** CSV 匯入格式容易猜錯，提供範例檔案讓使用者照著填，而不是只靠文字說明。 */
const PARTICIPANT_CSV_TEMPLATE = "部門,姓名,員工編號\r\n法金資訊部,梁O強,99999\r\n";
const PRIZE_CSV_TEMPLATE = "抽獎順序,獎項,數量\r\n1,頭獎 台積電1張,1\r\n2,二獎 歐洲機票1張,1\r\n3,參加獎 電影票,10\r\n";

/** 讀檔並解碼：優先信任 BOM，沒有 BOM 時先試 UTF-8，失敗才落回 Big5／
 *  Windows-1252 的啟發式判斷（見 lib/text-encoding.ts，跟 CSV 編輯器／隨機分組
 *  共用同一套邏輯）。使用者也可以手動指定編碼覆蓋自動判斷。 */
async function readCsvText(file: File, preference: TextEncodingPreference) {
  const bytes = await file.arrayBuffer();
  return decodeTextBytes(new Uint8Array(bytes), preference);
}

/** 範例 CSV 開頭加上 Excel 認得的 sep=, 宣告列，避免使用者 Windows 地區設定的
 *  清單分隔符號不是逗號時，雙擊開啟會整列被塞進同一欄；`lib/csv.ts` 重新上傳
 *  這份檔案時也認得這一行，不會誤判成一筆資料。 */
function downloadCsvTemplate(content: string, filename: string) {
  downloadBlob(new Blob([`﻿sep=,\r\n${content}`], { type: "text/csv;charset=utf-8" }), filename);
}

type DecodedUploadImage = {
  width: number;
  height: number;
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void;
  close: () => void;
};

/** 依參考專案的 800px 寬度／JPEG 方式縮圖，再加上 Toolverse 的容量上限保護。 */
async function decodeUploadImage(file: File): Promise<DecodedUploadImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (context, width, height) => context.drawImage(bitmap, 0, 0, width, height),
        close: () => bitmap.close(),
      };
    } catch {
      // Safari 與部分圖片格式不支援 createImageBitmap；退回原版的 Image 解碼流程。
    }
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("圖片解碼失敗"));
      element.src = objectUrl;
    });
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      draw: (context, width, height) => context.drawImage(image, 0, 0, width, height),
      close: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

/** 圖片上傳一律先縮圖再存進 localStorage：避免單張圖片就把容量塞爆。 */
async function resizeImageToDataUrl(file: File, maxWidth = 800, quality = 0.7): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("請選擇圖片檔案");
  if (file.size > 15 * 1024 * 1024) throw new Error("圖片檔案過大，上限 15MB");
  const image = await decodeUploadImage(file);
  try {
    const scale = Math.min(1, maxWidth / image.width);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("這個瀏覽器不支援圖片處理");
    image.draw(context, width, height);
    let currentQuality = quality;
    let dataUrl = canvas.toDataURL("image/jpeg", currentQuality);
    while (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH && currentQuality > 0.3) {
      currentQuality -= 0.15;
      dataUrl = canvas.toDataURL("image/jpeg", currentQuality);
    }
    if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) throw new Error("圖片處理後仍太大，請換一張較小的圖片");
    return dataUrl;
  } finally {
    image.close();
  }
}

/** 兩段式確認：第一次點擊只是「武裝」，幾秒內沒有第二次點擊就自動解除，避免手滑誤刪。 */
function useArmedConfirm(timeoutMs = 4000) {
  const [armedId, setArmedId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  function confirm(id: string, action: () => void) {
    if (armedId === id) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setArmedId(null);
      action();
      return;
    }
    setArmedId(id);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setArmedId(null), timeoutMs);
  }
  return { armedId, confirm };
}

export function EventLotteryConsole() {
  const [state, setState] = useState<LotteryEventState>(() => createEmptyEventState());
  const [hydrated, setHydrated] = useState(false);
  const [eventTitleDraft, setEventTitleDraft] = useState(() => createEmptyEventState().eventTitle);
  const [notice, setNotice] = useState<Notice | null>(null);

  // 控制台改回分頁切換：同一時間只渲染一個分頁的內容，避免單頁把所有面板都
  // 攤開造成又長又亂的捲動；上次停留的分頁存在 localStorage，重新整理後不用
  // 重新找路。
  const [activeTab, setActiveTab] = useState<TabId>("roster");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CONSOLE_TAB_STORAGE_KEY);
      // 還原上次停留的分頁需要一次性的 client hydration，不是由 render 推導的新 state。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved && TABS.some((tab) => tab.id === saved)) setActiveTab(saved as TabId);
    } catch {
      /* localStorage 不可用就停留在預設分頁 */
    }
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem(CONSOLE_TAB_STORAGE_KEY, activeTab); } catch { /* 存不進去不影響切分頁本身 */ }
  }, [activeTab]);

  // 舞台把某一輪（drawId）完全揭曉完畢後會回報 DRAW_FINISHED；控制台以此為準解鎖
  // 下一輪，而不是單純猜測動畫應該播完的時間到了（背景分頁的計時器可能被瀏覽器
  // 節流，導致舞台實際播完的時間比預期晚）。
  const [ackedDrawIds, setAckedDrawIds] = useState<ReadonlySet<string>>(() => new Set());

  const post = useEventLotterySync((message) => {
    if (message.type === "DRAW_ERROR") return; // 舞台端的暫時性提示，控制台不需要重新讀取狀態
    if (message.type === "DRAW_FINISHED") {
      setAckedDrawIds((current) => (current.has(message.drawId) ? current : new Set(current).add(message.drawId)));
      return;
    }
    setState(loadEventState());
  });

  useEffect(() => {
    // 還原活動狀態需要一次性的 client hydration。
    const storedState = loadEventState();
    // 這是把瀏覽器 localStorage 的外部狀態載入 React；不是由 render 推導的新 state。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(storedState);
    setEventTitleDraft(storedState.eventTitle);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) {
      // 同步跨分頁／匯入備份後的標題，避免輸入框仍顯示舊草稿。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEventTitleDraft(state.eventTitle);
    }
  }, [hydrated, state.eventTitle]);

  function showNotice(text: string, tone: Notice["tone"] = "info") {
    setNotice({ text, tone });
  }

  function handleUpdateEventTitle() {
    const title = eventTitleDraft.trim().slice(0, MAX_TITLE_LENGTH) || "🎊 歡樂公司尾牙 🎊";
    setEventTitleDraft(title);
    commit({ ...state, eventTitle: title });
  }

  /** 儲存失敗（例如 localStorage 容量不足）時整個操作要中止：不更新畫面、不廣播，
   *  避免其他分頁被通知了一個其實沒有真的落地的變更。 */
  function commit(next: LotteryEventState, message: EventLotterySyncMessage = { type: "STATE_UPDATED" }) {
    // 以 storage 中最新版本為基準，避免另一個分頁剛完成變更時把 revision 倒退。
    const latest = loadEventState();
    const versioned = advanceStateRevision({
      ...next,
      stateRevision: Math.max(next.stateRevision, latest.stateRevision),
    });
    if (!saveEventState(versioned)) {
      showNotice("儲存失敗，可能是瀏覽器儲存空間不足，這次變更未套用，請刪減圖片或紀錄後再試", "error");
      return;
    }
    setState(versioned);
    post(message);
  }

  // ---- 手機遙控（optional enhancement，Supabase 沒設定或連不上都不影響上面的本機抽獎） ----
  const supabaseConfigured = useMemo(() => isSupabaseConfigured(), []);
  const [remoteSession, setRemoteSession] = useState<StoredRemoteSessionPointer | null>(null);
  const [remoteQrDataUrl, setRemoteQrDataUrl] = useState("");
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteNotice, setRemoteNotice] = useState<Notice | null>(null);
  const [remotePairedAt, setRemotePairedAt] = useState<number | null>(null);
  const remoteChannelRef = useRef<RemoteChannelHandle | null>(null);

  function showRemoteNotice(text: string, tone: Notice["tone"] = "info") {
    setRemoteNotice({ text, tone });
  }

  async function subscribeRemoteChannel(sessionId: string) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    remoteChannelRef.current?.close();
    remoteChannelRef.current = null;
    const handle = await connectRemoteChannel(supabase, sessionId, (message) => {
      // 控制台只被動觀察配對狀態（手機連上時會送 REMOTE_HELLO），實際指令一律由
      // 舞台處理，避免控制台與舞台同時處理同一個手機命令。
      if (message.type === "REMOTE_HELLO") {
        setRemotePairedAt(Date.now());
        try { window.sessionStorage.removeItem(EVENT_LOTTERY_REMOTE_PAIRING_TOKEN_KEY); } catch { /* sessionStorage 不可用不影響配對 */ }
        setRemoteQrDataUrl("");
      }
    });
    remoteChannelRef.current = handle;
  }

  useEffect(() => {
    if (!supabaseConfigured || typeof window === "undefined") return;
    let cancelled = false;
    try {
      const raw = window.localStorage.getItem(EVENT_LOTTERY_REMOTE_STORAGE_KEY);
      const pointer = raw ? sanitizeStoredRemoteSessionPointer(JSON.parse(raw)) : null;
      if (pointer && isRemoteSessionUsable({ expiresAt: pointer.expiresAt, revokedAt: null })) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRemoteSession(pointer);
        let pairingToken: string | null = null;
        try { pairingToken = window.sessionStorage.getItem(EVENT_LOTTERY_REMOTE_PAIRING_TOKEN_KEY); } catch { /* sessionStorage 不可用仍要繼續訂閱既有 session */ }
        if (pairingToken && /^[0-9a-f]{64}$/i.test(pairingToken)) {
          void import("qrcode").then(({ default: QRCode }) => QRCode.toDataURL(
            buildPairingUrl(window.location.origin, pointer.sessionId, pairingToken),
            { errorCorrectionLevel: "M", margin: 2, width: 320 },
          )).then((dataUrl) => { if (!cancelled) setRemoteQrDataUrl(dataUrl); }).catch(() => undefined);
        }
        void subscribeRemoteChannel(pointer.sessionId).then(() => { if (cancelled) remoteChannelRef.current?.close(); });
      } else if (raw) {
        window.localStorage.removeItem(EVENT_LOTTERY_REMOTE_STORAGE_KEY);
      }
    } catch {
      /* localStorage 損壞就當作沒有先前的 session */
    }
    return () => {
      cancelled = true;
      remoteChannelRef.current?.close();
      remoteChannelRef.current = null;
    };
  }, [supabaseConfigured]);

  async function handleEnableRemote() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { showRemoteNotice("尚未設定手機遙控服務", "error"); return; }
    setRemoteBusy(true);
    setRemoteNotice(null);
    try {
      await ensureAnonymousSession(supabase);
      const token = generatePairingToken();
      const { data, error } = await supabase.rpc("create_lottery_remote_session", { pairing_token: token });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error("建立遙控 session 失敗");
      const pointer: StoredRemoteSessionPointer = { sessionId: row.id, topic: row.topic, expiresAt: row.expires_at };
      window.localStorage.setItem(EVENT_LOTTERY_REMOTE_STORAGE_KEY, JSON.stringify(pointer));
      try { window.sessionStorage.setItem(EVENT_LOTTERY_REMOTE_PAIRING_TOKEN_KEY, token); } catch { /* 沒有 sessionStorage 仍可在目前畫面顯示 QR */ }
      setRemoteSession(pointer);
      setRemotePairedAt(null);

      const pairingUrl = buildPairingUrl(window.location.origin, pointer.sessionId, token);
      const QRCode = (await import("qrcode")).default;
      const dataUrl = await QRCode.toDataURL(pairingUrl, { errorCorrectionLevel: "M", margin: 2, width: 320 });
      setRemoteQrDataUrl(dataUrl);
      await subscribeRemoteChannel(pointer.sessionId);
    } catch (error) {
      showRemoteNotice(error instanceof Error ? error.message : "啟用手機遙控失敗，請稍後再試", "error");
    } finally {
      setRemoteBusy(false);
    }
  }

  async function handleRevokeRemote() {
    const supabase = getSupabaseBrowserClient();
    if (!remoteSession) return;
    setRemoteBusy(true);
    try {
      if (!supabase) throw new Error("尚未設定手機遙控服務");
      const { error } = await supabase.rpc("revoke_lottery_remote_session", { session_id: remoteSession.sessionId });
      if (error) throw error;
      try {
        await remoteChannelRef.current?.send({ type: "SESSION_REVOKED" });
      } catch {
        /* DB 已完成撤銷；即時通知只是加速讓手機離線，失敗不影響權限撤銷。 */
      }
      showRemoteNotice("已撤銷手機遙控");
      remoteChannelRef.current?.close();
      remoteChannelRef.current = null;
      window.localStorage.removeItem(EVENT_LOTTERY_REMOTE_STORAGE_KEY);
      try { window.sessionStorage.removeItem(EVENT_LOTTERY_REMOTE_PAIRING_TOKEN_KEY); } catch { /* ignore */ }
      setRemoteSession(null);
      setRemoteQrDataUrl("");
      setRemotePairedAt(null);
    } catch (error) {
      // RPC 失敗時保留 session 指標與控制項，讓使用者可以重試；不能讓
      // 資料庫仍有效的 session 失去撤銷入口。
      showRemoteNotice(error instanceof Error ? error.message : "撤銷失敗，請稍後再試", "error");
    } finally {
      setRemoteBusy(false);
    }
  }

  // 純粹驅動「配對是否還算在線」的畫面更新；沒有配對紀錄時完全不需要跑計時器。
  const [remoteNowTick, setRemoteNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (remotePairedAt === null) return;
    const interval = setInterval(() => setRemoteNowTick(Date.now()), 5000);
    return () => clearInterval(interval);
  }, [remotePairedAt]);

  const remotePaired = remotePairedAt !== null;
  const remotePairedStale = remotePairedAt !== null && remoteNowTick - remotePairedAt > 30_000;

  // 抽選揭曉時間到了之前，畫面需要每隔一小段時間重新算一次「現在是否該解鎖」；
  // 沒有進行中的揭曉、或這一輪已經被舞台回報播完時，完全不跑計時器。
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const pending = state.pendingReveal;
    const noticeUntil = state.stageNotice ? Date.parse(state.stageNotice.until) : 0;
    const previewCompleteAt = state.stagePreview ? stagePreviewCompleteAt(state.stagePreview) : 0;
    if ((!pending || ackedDrawIds.has(pending.drawId))
      && (!noticeUntil || Date.now() >= noticeUntil)
      && (!previewCompleteAt || Date.now() >= previewCompleteAt)) return;
    const interval = setInterval(() => setNowTick(Date.now()), 250);
    return () => clearInterval(interval);
    // 刻意只依賴 drawId／revealAt／previewRevealAt 這些原始值，不用整個物件：其他跟
    // 這一輪無關的變更（重新讀取狀態等）不該讓這個計時器重新啟動。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pendingReveal?.drawId, state.pendingReveal?.revealAt, state.stageNotice?.until, state.stagePreview?.revealAt, ackedDrawIds]);

  // 解鎖優先看舞台的 DRAW_FINISHED 回報；如果舞台分頁根本沒開、或訊息漏接，
  // 用「理論播完時間 + 安全緩衝」當備援，避免控制台永遠鎖死。
  const pendingReveal = state.pendingReveal;
  const pendingAcked = pendingReveal !== null && ackedDrawIds.has(pendingReveal.drawId);
  const noticeLocked = state.stageNotice !== null && nowTick < Date.parse(state.stageNotice.until);
  const previewLocked = state.stagePreview !== null && nowTick < stagePreviewCompleteAt(state.stagePreview);
  const drawLocked = noticeLocked || previewLocked || (pendingReveal !== null && !pendingAcked && nowTick < pendingRevealCompleteAt(pendingReveal) + DRAW_LOCK_FALLBACK_MARGIN_MS);

  const rosterConfirm = useArmedConfirm();
  const participantConfirm = useArmedConfirm();
  const prizeConfirm = useArmedConfirm();
  const winnerConfirm = useArmedConfirm();
  const resetConfirm = useArmedConfirm();
  const clearAllConfirm = useArmedConfirm();
  const backgroundConfirm = useArmedConfirm();

  // ---- 活動設定 ----
  const backupInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);

  function handleExportBackup() {
    downloadBlob(new Blob([exportEventBackup(state)], { type: "application/json;charset=utf-8" }), eventBackupFileName(state));
  }

  async function handleImportBackup(file: File) {
    try {
      const text = await file.text();
      const imported = parseEventBackup(JSON.parse(text));
      commit(imported);
      showNotice("已匯入活動備份");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "匯入失敗，請確認是本工具匯出的備份檔", "error");
    }
  }

  function handleClearAllData() {
    clearAllConfirm.confirm("clear-all", () => {
      // 重置整個活動時也撤銷手機 session；否則手機可能仍保有一條有效的遠端
      // 配對，下一次活動重建前台狀態後會意外繼續收到舊遙控器命令。
      if (remoteSession) void handleRevokeRemote();
      commit(createEmptyEventState());
      showNotice("已清除所有資料");
    });
  }

  async function handleBackgroundImage(file: File) {
    try {
      const dataUrl = await resizeImageToDataUrl(file, 800, 0.7);
      commit({ ...state, backgroundImageDataUrl: dataUrl });
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "圖片處理失敗", "error");
    }
  }

  function handleResetBackground() {
    backgroundConfirm.confirm("reset-background", () => commit({ ...state, backgroundImageDataUrl: null }));
  }

  // ---- 名單群組 ----
  const [newRosterName, setNewRosterName] = useState("");

  function handleAddRoster() {
    const name = newRosterName.trim();
    if (!name) return;
    if (state.rosters.length >= MAX_ROSTERS) { showNotice(`最多只能建立 ${MAX_ROSTERS} 個名單群組`, "error"); return; }
    commit({ ...state, rosters: [...state.rosters, createRoster(name)] });
    setNewRosterName("");
  }

  function handleRenameRoster(id: string, name: string) {
    const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
    if (!trimmed) return;
    commit({ ...state, rosters: state.rosters.map((roster) => (roster.id === id ? { ...roster, name: trimmed } : roster)) });
  }

  function handleDeleteRoster(id: string) {
    if (!canDeleteRoster(state, id)) {
      showNotice("這個名單群組裡有成員已經有得獎紀錄，無法整組刪除；請先個別停用不再需要的人，得獎者無法刪除", "error");
      return;
    }
    rosterConfirm.confirm(id, () => {
      const remainingRosterIds = state.rosters.filter((roster) => roster.id !== id).map((roster) => roster.id);
      commit({
        ...state,
        rosters: state.rosters.filter((roster) => roster.id !== id),
        participants: state.participants.filter((participant) => participant.rosterId !== id),
        prizes: state.prizes.map((prize) => {
          if (prize.eligibleRosterIds.length === 0) return prize;
          const eligibleRosterIds = prize.eligibleRosterIds.filter((rid) => rid !== id);
          return { ...prize, eligibleRosterIds: eligibleRosterIds.length > 0 ? eligibleRosterIds : remainingRosterIds };
        }),
      });
    });
  }

  // ---- 參加者管理 ----
  const [manualName, setManualName] = useState("");
  const [manualEmployeeId, setManualEmployeeId] = useState("");
  const [manualDepartment, setManualDepartment] = useState("");
  const [manualRosterId, setManualRosterId] = useState("");
  const [participantFilterRosterId, setParticipantFilterRosterId] = useState<string>("all");
  const [csvRosterId, setCsvRosterId] = useState("");
  const [participantCsvEncoding, setParticipantCsvEncoding] = useState<TextEncodingPreference>("auto");
  const [participantCsvDetectedEncoding, setParticipantCsvDetectedEncoding] = useState<DetectedTextEncoding | null>(null);
  const [participantCsvFile, setParticipantCsvFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState("");
  const csvFileInputRef = useRef<HTMLInputElement>(null);
  const [participantPage, setParticipantPage] = useState(1);

  const firstRosterId = state.rosters[0]?.id ?? "";
  const effectiveManualRosterId = state.rosters.some((roster) => roster.id === manualRosterId) ? manualRosterId : firstRosterId;
  const effectiveCsvRosterId = state.rosters.some((roster) => roster.id === csvRosterId) ? csvRosterId : firstRosterId;

  function addParticipantToRoster(rosterId: string, values: { name: string; employeeId: string; department: string }): boolean {
    const name = values.name.trim();
    const employeeId = values.employeeId.trim();
    if (!name) { showNotice("請輸入姓名", "error"); return false; }
    if (!employeeId) { showNotice("姓名與員工編號為必填欄位", "error"); return false; }
    if (!state.rosters.some((roster) => roster.id === rosterId)) { showNotice("請先建立至少一個名單群組", "error"); return false; }
    const duplicate = findDuplicateEmployeeId(state.participants, employeeId);
    if (duplicate && !window.confirm(`員工編號「${employeeId}」已存在於「${duplicate.name}」的名單中，是否仍要新增？`)) return false;
    if (state.participants.length >= MAX_PARTICIPANTS) { showNotice(`最多只能有 ${MAX_PARTICIPANTS} 位參加者`, "error"); return false; }
    commit({ ...state, participants: [...state.participants, createParticipant({ name, employeeId, department: values.department, rosterId })] });
    showNotice(`已新增「${name}」`);
    return true;
  }

  function handleAddParticipant() {
    if (!addParticipantToRoster(effectiveManualRosterId, { name: manualName, employeeId: manualEmployeeId, department: manualDepartment })) return;
    setManualName(""); setManualEmployeeId(""); setManualDepartment("");
  }

  function handleToggleActive(id: string) {
    commit({ ...state, participants: state.participants.map((participant) => (participant.id === id ? { ...participant, active: !participant.active } : participant)) });
  }

  function handleDeleteParticipant(id: string) {
    if (!canDeleteParticipant(state, id)) {
      showNotice("這位參加者已經有得獎紀錄，無法刪除；如果不想讓他繼續抽選，請改為停用", "error");
      return;
    }
    participantConfirm.confirm(id, () => {
      commit({ ...state, participants: state.participants.filter((participant) => participant.id !== id) });
    });
  }

  function applyParticipantCsv(text: string, rosterId = effectiveCsvRosterId) {
    if (!rosterId) { showNotice("請先選擇要匯入到哪個名單群組", "error"); return; }
    const { rows, warnings } = parseParticipantsCsv(text);
    if (rows.length === 0) { showNotice("這份 CSV 沒有可用的資料列", "error"); return; }
    const duplicateRows = rows.filter((row) => Boolean(row.employeeId && state.participants.some((participant) => participant.employeeId === row.employeeId)));
    if (duplicateRows.length > 0) {
      const sameRosterCount = duplicateRows.filter((row) => state.participants.some((participant) => participant.employeeId === row.employeeId && participant.rosterId === rosterId)).length;
      const otherRosterCount = duplicateRows.length - sameRosterCount;
      const details = [
        sameRosterCount > 0 ? `同一名單會更新 ${sameRosterCount} 筆姓名／部門並重新啟用` : "",
        otherRosterCount > 0 ? `${otherRosterCount} 筆跨名單重複在確認後會新增` : "",
      ].filter(Boolean).join("；");
      if (!window.confirm(`發現 ${duplicateRows.length} 筆已存在的員工編號。\n${details}\n\n確定要繼續匯入嗎？`)) {
        showNotice("已取消 CSV 匯入");
        return;
      }
    }
    const result = mergeParticipantsFromCsv(state.participants, rows, rosterId, {
      updateExistingInRoster: duplicateRows.length > 0,
      allowCrossRosterDuplicates: duplicateRows.length > 0,
    });
    commit({ ...state, participants: result.participants });
    const messages = [`已匯入 ${result.added} 位${result.updated > 0 ? `，更新 ${result.updated} 位` : ""}`];
    if (warnings.length > 0) messages.push(...warnings);
    if (result.skipped.length > 0) messages.push(`略過 ${result.skipped.length} 位重複員工編號：${result.skipped.slice(0, 5).join("、")}${result.skipped.length > 5 ? "…" : ""}`);
    showNotice(messages.join("；"), result.skipped.length > 0 || warnings.length > 0 ? "error" : "info");
    setCsvText("");
  }

  async function handleCsvFile(file: File, rosterId = effectiveCsvRosterId, preference: TextEncodingPreference = participantCsvEncoding) {
    try {
      const decoded = await readCsvText(file, preference);
      setParticipantCsvDetectedEncoding(decoded.encoding);
      applyParticipantCsv(decoded.text, rosterId);
    } catch {
      showNotice("讀取 CSV 檔案失敗", "error");
    }
  }

  async function uploadParticipantCsv() {
    if (!participantCsvFile) { showNotice("請先選擇 CSV 檔案", "error"); return; }
    await handleCsvFile(participantCsvFile);
    setParticipantCsvFile(null);
    if (csvFileInputRef.current) csvFileInputRef.current.value = "";
  }

  function clearRoster(id: string) {
    const hasHistory = state.participants.some((participant) => participant.rosterId === id && !canDeleteParticipant(state, participant.id));
    if (hasHistory) {
      showNotice("這個名單含有得獎歷史，為保留紀錄不能整組清空；請逐一停用其他人員", "error");
      return;
    }
    rosterConfirm.confirm(`clear:${id}`, () => {
      commit({ ...state, participants: state.participants.filter((participant) => participant.rosterId !== id) });
    });
  }

  const rosterById = useMemo(() => new Map(state.rosters.map((roster) => [roster.id, roster])), [state.rosters]);
  const visibleParticipants = useMemo(
    () => (participantFilterRosterId === "all" ? state.participants : state.participants.filter((participant) => participant.rosterId === participantFilterRosterId)),
    [state.participants, participantFilterRosterId],
  );
  const participantTotalPages = Math.max(1, Math.ceil(visibleParticipants.length / PARTICIPANT_PAGE_SIZE));
  const participantPageClamped = Math.min(Math.max(1, participantPage), participantTotalPages);
  const paginatedParticipants = visibleParticipants.slice((participantPageClamped - 1) * PARTICIPANT_PAGE_SIZE, participantPageClamped * PARTICIPANT_PAGE_SIZE);
  const [remainingRosterFilter, setRemainingRosterFilter] = useState("all");
  const [remainingSearch, setRemainingSearch] = useState("");
  const [remainingPage, setRemainingPage] = useState(1);
  const [showRemainingRoster, setShowRemainingRoster] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showDisqualify, setShowDisqualify] = useState(false);
  const availableParticipants = useMemo(
    () => state.participants.filter((participant) => participant.active && !state.winners.some((winner) => !winner.disqualified && winner.participantId === participant.id)),
    [state.participants, state.winners],
  );
  const remainingParticipants = useMemo(() => {
    const query = remainingSearch.trim().toLowerCase();
    return availableParticipants.filter((participant) => {
      if (remainingRosterFilter !== "all" && participant.rosterId !== remainingRosterFilter) return false;
      if (!query) return true;
      return [participant.name, participant.employeeId, participant.department].some((value) => value.toLowerCase().includes(query));
    });
  }, [availableParticipants, remainingRosterFilter, remainingSearch]);
  const remainingTotalPages = Math.max(1, Math.ceil(remainingParticipants.length / PARTICIPANT_PAGE_SIZE));
  const remainingPageClamped = Math.min(Math.max(1, remainingPage), remainingTotalPages);
  const paginatedRemainingParticipants = remainingParticipants.slice((remainingPageClamped - 1) * PARTICIPANT_PAGE_SIZE, remainingPageClamped * PARTICIPANT_PAGE_SIZE);

  // ---- 獎項管理 ----
  const [prizeName, setPrizeName] = useState("");
  const [prizeCount, setPrizeCount] = useState(1);
  const [prizeAllowRepeat, setPrizeAllowRepeat] = useState(false);
  const [prizeImageDataUrl, setPrizeImageDataUrl] = useState<string | null>(null);
  const [prizeRosterIds, setPrizeRosterIds] = useState<string[]>(() => {
    const defaults = createEmptyEventState().rosters;
    return defaults[0] ? [defaults[0].id] : [];
  });
  const [prizeInsertAfter, setPrizeInsertAfter] = useState("");
  const [prizeCsvText, setPrizeCsvText] = useState("");
  const [prizeCsvEncoding, setPrizeCsvEncoding] = useState<TextEncodingPreference>("auto");
  const [prizeCsvDetectedEncoding, setPrizeCsvDetectedEncoding] = useState<DetectedTextEncoding | null>(null);
  const [prizeCsvFile, setPrizeCsvFile] = useState<File | null>(null);
  const [prizeCsvRosterIds, setPrizeCsvRosterIds] = useState<string[]>(() => {
    const defaults = createEmptyEventState().rosters;
    return defaults[0] ? [defaults[0].id] : [];
  });
  const prizeCsvFileInputRef = useRef<HTMLInputElement>(null);
  const newPrizeImageInputRef = useRef<HTMLInputElement>(null);
  const prizeImageInputRefs = useRef(new Map<string, HTMLInputElement | null>());
  const dragPrizeIdRef = useRef<string | null>(null);
  const [dragOverPrizeId, setDragOverPrizeId] = useState<string | null>(null);
  const [editingPrizeId, setEditingPrizeId] = useState<string | null>(null);
  const [editingPrizeDraft, setEditingPrizeDraft] = useState<{ name: string; totalCount: number; eligibleRosterIds: string[]; allowRepeatWinners: boolean } | null>(null);

  const orderedPrizes = useMemo(() => [...state.prizes].sort((a, b) => a.order - b.order), [state.prizes]);
  const editingPrize = editingPrizeId ? state.prizes.find((prize) => prize.id === editingPrizeId) ?? null : null;
  const allRosterIds = useMemo(() => state.rosters.map((roster) => roster.id), [state.rosters]);
  const effectivePrizeRosterIds = useMemo(() => {
    const valid = prizeRosterIds.filter((id) => state.rosters.some((roster) => roster.id === id));
    return valid.length > 0 ? valid : (state.rosters[0] ? [state.rosters[0].id] : []);
  }, [prizeRosterIds, state.rosters]);
  const effectivePrizeCsvRosterIds = useMemo(() => {
    const valid = prizeCsvRosterIds.filter((id) => state.rosters.some((roster) => roster.id === id));
    return valid.length > 0 ? valid : (state.rosters[0] ? [state.rosters[0].id] : []);
  }, [prizeCsvRosterIds, state.rosters]);

  function togglePrizeRosterSelection(rosterId: string, checked: boolean) {
    if (!checked && effectivePrizeRosterIds.length === 1 && effectivePrizeRosterIds[0] === rosterId) {
      showNotice("至少要保留一個可參加的名單群組", "error");
      return;
    }
    setPrizeRosterIds((current) => checked ? [...current.filter((id) => id !== rosterId), rosterId] : current.filter((id) => id !== rosterId));
  }

  function togglePrizeCsvRosterSelection(rosterId: string, checked: boolean) {
    if (!checked && effectivePrizeCsvRosterIds.length === 1 && effectivePrizeCsvRosterIds[0] === rosterId) {
      showNotice("至少要保留一個 CSV 匯入對象名單", "error");
      return;
    }
    setPrizeCsvRosterIds((current) => checked ? [...current.filter((id) => id !== rosterId), rosterId] : current.filter((id) => id !== rosterId));
  }

  function handleAddPrize() {
    const name = prizeName.trim();
    if (!name) { showNotice("請輸入獎項名稱", "error"); return; }
    if (state.prizes.length >= MAX_PRIZES) { showNotice(`最多只能有 ${MAX_PRIZES} 個獎項`, "error"); return; }
    const insertAfter = Number.parseInt(prizeInsertAfter, 10);
    const ordered = [...state.prizes].sort((a, b) => a.order - b.order);
    const insertIndex = Number.isInteger(insertAfter) && insertAfter >= 1 && insertAfter <= ordered.length ? insertAfter : ordered.length;
    const nextOrdered = [...ordered];
    const created = createPrize({ name, totalCount: prizeCount, eligibleRosterIds: effectivePrizeRosterIds, allowRepeatWinners: prizeAllowRepeat, imageDataUrl: prizeImageDataUrl, order: insertIndex });
    nextOrdered.splice(insertIndex, 0, created);
    const prizes = nextOrdered.map((prize, index) => ({ ...prize, order: index }));
    commit({ ...state, prizes });
    setPrizeName(""); setPrizeCount(1); setPrizeAllowRepeat(false); setPrizeImageDataUrl(null); setPrizeRosterIds(firstRosterId ? [firstRosterId] : []); setPrizeInsertAfter("");
  }

  async function handleNewPrizeImage(file: File) {
    try {
      setPrizeImageDataUrl(await resizeImageToDataUrl(file, 800, 0.7));
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "圖片處理失敗", "error");
    }
  }

  function handleUpdatePrize(id: string, patch: Partial<EventPrize>) {
    commit({ ...state, prizes: state.prizes.map((prize) => (prize.id === id ? { ...prize, ...patch } : prize)) });
  }

  function openPrizeEditor(prize: EventPrize) {
    setEditingPrizeId(prize.id);
    setEditingPrizeDraft({
      name: prize.name,
      totalCount: prize.totalCount,
      eligibleRosterIds: prize.eligibleRosterIds.length > 0 ? [...prize.eligibleRosterIds] : [...allRosterIds],
      allowRepeatWinners: prize.allowRepeatWinners,
    });
  }

  function closePrizeEditor() {
    setEditingPrizeId(null);
    setEditingPrizeDraft(null);
  }

  function savePrizeEditor() {
    if (!editingPrizeId || !editingPrizeDraft) return;
    const prize = state.prizes.find((item) => item.id === editingPrizeId);
    if (!prize) { closePrizeEditor(); return; }
    const name = editingPrizeDraft.name.trim().slice(0, MAX_NAME_LENGTH);
    if (!name) { showNotice("請輸入獎項名稱", "error"); return; }
    const eligibleRosterIds = [...new Set(editingPrizeDraft.eligibleRosterIds.filter((id) => state.rosters.some((roster) => roster.id === id)))];
    if (state.rosters.length > 0 && eligibleRosterIds.length === 0) { showNotice("最少必須選擇一個抽獎對象名單", "error"); return; }
    handleUpdatePrize(editingPrizeId, {
      name,
      totalCount: Math.max(prize.drawnCount, Math.round(editingPrizeDraft.totalCount) || prize.totalCount),
      eligibleRosterIds,
      allowRepeatWinners: editingPrizeDraft.allowRepeatWinners,
    });
    closePrizeEditor();
  }

  function handleDeletePrize(id: string) {
    if (!canDeletePrize(state, id)) {
      showNotice("這個獎項已經有得獎紀錄（含已取消重抽的紀錄），無法刪除，避免紀錄出現懸空引用", "error");
      return;
    }
    prizeConfirm.confirm(id, () => {
      commit({ ...state, prizes: state.prizes.filter((prize) => prize.id !== id) });
    });
  }

  function reorderPrizes(nextOrdered: EventPrize[]) {
    commit({ ...state, prizes: nextOrdered.map((prize, index) => ({ ...prize, order: index })) });
  }

  function movePrize(id: string, direction: -1 | 1) {
    const index = orderedPrizes.findIndex((prize) => prize.id === id);
    const swapWith = index + direction;
    if (index < 0 || swapWith < 0 || swapWith >= orderedPrizes.length) return;
    const next = [...orderedPrizes];
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    reorderPrizes(next);
  }

  function handlePrizeDragOver(overId: string) {
    const dragId = dragPrizeIdRef.current;
    if (!dragId || dragId === overId) return;
    const fromIndex = orderedPrizes.findIndex((prize) => prize.id === dragId);
    const toIndex = orderedPrizes.findIndex((prize) => prize.id === overId);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = [...orderedPrizes];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    reorderPrizes(next);
  }

  async function handlePrizeImage(id: string, file: File) {
    try {
      const dataUrl = await resizeImageToDataUrl(file, 800, 0.7);
      handleUpdatePrize(id, { imageDataUrl: dataUrl });
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "圖片處理失敗", "error");
    }
  }

  async function handlePrizeCsvFile(file: File) {
    try {
      const decoded = await readCsvText(file, prizeCsvEncoding);
      setPrizeCsvDetectedEncoding(decoded.encoding);
      applyPrizeCsv(decoded.text);
    } catch {
      showNotice("讀取 CSV 檔案失敗", "error");
    }
  }

  async function uploadPrizeCsv() {
    if (!prizeCsvFile) { showNotice("請先選擇獎項 CSV 檔案", "error"); return; }
    await handlePrizeCsvFile(prizeCsvFile);
    setPrizeCsvFile(null);
    if (prizeCsvFileInputRef.current) prizeCsvFileInputRef.current.value = "";
  }

  function applyPrizeCsv(text: string) {
    const startOrder = state.prizes.length > 0 ? Math.max(...state.prizes.map((prize) => prize.order)) + 1 : 0;
    const { prizes, warnings } = parsePrizesCsv(text, state.rosters, startOrder);
    if (prizes.length === 0) { showNotice("這份 CSV 沒有可用的獎項資料", "error"); return; }
    if (effectivePrizeCsvRosterIds.length === 0) { showNotice("請至少選擇一個 CSV 匯入對象名單", "error"); return; }
    // 原版 CSV 匯入的對象名單是整批設定，不是依每一列猜測；保留 parser
    // 對「適用名單」欄位的支援，但由這組明確勾選的目標名單作最後決定。
    const imported = prizes.map((prize) => ({ ...prize, eligibleRosterIds: effectivePrizeCsvRosterIds }));
    commit({ ...state, prizes: [...state.prizes, ...imported] });
    const messages = [`已匯入 ${imported.length} 個獎項`, ...warnings];
    showNotice(messages.join("；"), warnings.length > 0 ? "error" : "info");
    setPrizeCsvText("");
  }

  // ---- 抽獎控制 ----
  const [drawPrizeId, setDrawPrizeId] = useState("");

  // 「本輪抽出人數」是活動狀態的一部分（stageDrawCount），不是控制台自己的 local
  // state：手機遙控、舞台鍵盤／滑鼠／簡報筆與控制台都要讀同一份數字，改一處
  // 全部同步，不會各自維護不同人數。
  function handleStageDrawCountChange(value: number) {
    const next = Math.min(MAX_DRAW_COUNT_PER_ROUND, Math.max(1, Math.round(value) || 1));
    if (next === state.stageDrawCount) return;
    commit({ ...state, stageDrawCount: next });
  }

  /** 選好獎項時把「本輪抽出人數」重設為這個獎項目前的剩餘名額——一個獎項
   *  預設就是一次全部抽完（跟 prepareStagePrize() 對「同步顯示於前台」的行為
   *  一致），操作人員直接按「強制開始抽獎」跳過準備步驟也不會漏抽或要手動
   *  改好幾次數字；需要分批抽選時仍可以在下方欄位自行改小。 */
  function handleSelectDrawPrize(prizeId: string) {
    setDrawPrizeId(prizeId);
    const prize = orderedPrizes.find((item) => item.id === prizeId);
    if (!prize) return;
    const fullCount = Math.max(1, Math.min(remainingSlots(prize), candidatePool(state, prize.id).length, MAX_DRAW_COUNT_PER_ROUND));
    if (fullCount !== state.stageDrawCount) commit({ ...state, stageDrawCount: fullCount });
  }

  // 對齊原後台：控制台初始不預選獎項，主持人必須明確選擇後才能準備或抽獎，
  // 避免剛開頁面就誤觸第一個獎項。
  const effectiveDrawPrizeId = orderedPrizes.some((prize) => prize.id === drawPrizeId) ? drawPrizeId : "";
  const drawTargetPrize = orderedPrizes.find((prize) => prize.id === effectiveDrawPrizeId) ?? null;
  const drawCandidates = drawTargetPrize ? candidatePool(state, drawTargetPrize.id) : [];
  const drawRemaining = drawTargetPrize ? remainingSlots(drawTargetPrize) : 0;
  const remainingPrizes = orderedPrizes.filter((prize) => remainingSlots(prize) > 0);
  const remainingPrizeSlots = remainingPrizes.reduce((sum, prize) => sum + remainingSlots(prize), 0);
  const nextAvailablePrize = findNextDrawablePrize(state);

  function handlePrepareStage() {
    if (drawLocked) return;
    if (!drawTargetPrize) { showNotice("請先選擇獎項", "error"); return; }
    const result = prepareStage(state, drawTargetPrize.id, post);
    if (!result.ok) { showNotice(result.reason, "error"); return; }
    setState(result.state);
    showNotice(`舞台已準備顯示「${drawTargetPrize.name}」`);
  }

  function handleStartDraw() {
    if (drawLocked) return;
    if (!drawTargetPrize) { showNotice("請先選擇獎項", "error"); return; }
    const result = startDraw(state, drawTargetPrize.id, state.stageDrawCount, post);
    if (!result.ok) { showNotice(result.reason, "error"); return; }
    setNotice(null);
    setState(result.state);
  }

  function handleClearStage() {
    const result = clearStageAction(state, post);
    if (!result.ok) { showNotice(result.reason, "error"); return; }
    setState(result.state);
  }

  function handleResetEvent() {
    resetConfirm.confirm("reset", () => {
      commit(resetEventDraws(state), { type: "RESET_EVENT" });
    });
  }

  // ---- 得獎紀錄 ----
  const prizeNameById = useMemo(() => new Map(state.prizes.map((prize) => [prize.id, prize.name])), [state.prizes]);
  const sortedWinners = useMemo(() => [...state.winners].sort((a, b) => b.drawnAt.localeCompare(a.drawnAt)), [state.winners]);

  function handleDisqualify(winnerId: string) {
    winnerConfirm.confirm(winnerId, () => {
      try {
        commit(disqualifyWinner(state, winnerId), { type: "DISQUALIFY_WINNER", winnerId });
      } catch (error) {
        showNotice(error instanceof Error ? error.message : "操作失敗", "error");
      }
    });
  }

  function handleShowPrizeWinners(prizeId: string) {
    if (state.stagePreview?.prizeId === prizeId) {
      const result = clearStageAction(state, post);
      if (!result.ok) { showNotice(result.reason, "error"); return; }
      setState(result.state);
      showNotice("已停止顯示這個獎項的名單");
      return;
    }
    const result = previewPrizeWinnersAction(state, prizeId, post);
    if (!result.ok) { showNotice(result.reason, "error"); return; }
    setState(result.state);
    showNotice("已將這個獎項的歷史得獎名單重新顯示於舞台");
  }

  function handleExportWinnersCsv() {
    downloadBlob(new Blob([winnersToCsv(state)], { type: "text/csv;charset=utf-8" }), `歷史中獎名單_${Date.now()}.csv`);
  }

  function handleExportRemainingCsv() {
    const rows = [["部門", "姓名", "員工編號", "名單組別"], ...remainingParticipants.map((participant) => [
      participant.department,
      participant.name,
      participant.employeeId,
      rosterById.get(participant.rosterId)?.name ?? "",
    ])];
    downloadBlob(new Blob([csvRowsToDownloadText(rows)], { type: "text/csv;charset=utf-8" }), `尚可抽人員名單-${Date.now()}.csv`);
  }

  /** 名單群組卡片只留名稱、人數與清空／刪除——CSV 上傳與手動新增人員統一在下面
   *  的「參加者管理」區塊做，不要讓同一件事有兩個入口。 */
  function renderRosterCards() {
    return (
      <div className="event-lottery-subsection">
        <h3>人員名單</h3>
        {state.rosters.length === 0
          ? <p className="result-empty"><strong>還沒有名單群組</strong>請先建立至少一個群組，才能加入參加者。</p>
          : <div className="event-lottery-roster-upload-grid">
          {state.rosters.map((roster) => {
            const memberCount = state.participants.filter((participant) => participant.rosterId === roster.id).length;
            return (
              <div className="event-lottery-roster-upload-card" key={roster.id}>
                <div className="event-lottery-roster-upload-heading">
                  <input key={`${roster.id}:${roster.name}`} className="key-input" type="text" defaultValue={roster.name} maxLength={MAX_NAME_LENGTH} onBlur={(event) => handleRenameRoster(roster.id, event.target.value)} aria-label={`名單群組名稱：${roster.name}`} />
                  <span className="panel-meta">({memberCount}人)</span>
                </div>
                <div className="event-lottery-roster-upload-actions">
                  <button className="button button-small button-danger" type="button" onClick={() => clearRoster(roster.id)}>{rosterConfirm.armedId === `clear:${roster.id}` ? "再按一次清空" : "清空"}</button>
                  <button className="button button-small button-danger" type="button" onClick={() => handleDeleteRoster(roster.id)}>{rosterConfirm.armedId === roster.id ? "再按一次刪除" : "刪除群組"}</button>
                </div>
              </div>
            );
          })}
        </div>}
        <button className="button button-small button-secondary" type="button" onClick={() => downloadCsvTemplate(PARTICIPANT_CSV_TEMPLATE, "人員名單範例.csv")}>📥 下載人員名單範例</button>
      </div>
    );
  }

  /** 頁面頂部永遠可見的狀態列：不管在哪個分頁，都能一眼看到目前獎項進度、
   *  前台鎖定狀態與手機遙控連線情形，不必特地切到「抽獎控制」分頁才看得到。 */
  function renderStatusBar() {
    const remoteStatusLabel = !supabaseConfigured
      ? "遙控未設定"
      : !remoteSession
        ? "遙控未啟用"
        : remotePaired
          ? (remotePairedStale ? "遙控可能離線" : "遙控已配對")
          : "等待手機配對";
    return (
      <div className="event-lottery-status-bar">
        <span className="event-lottery-status-item">
          🎁 {remainingPrizes.length > 0 ? <>剩餘 <strong>{remainingPrizes.length}</strong> 項獎項／<strong>{remainingPrizeSlots}</strong> 個名額</> : "所有獎項已抽完"}
        </span>
        <span className="event-lottery-status-item">
          👉 {nextAvailablePrize ? <>下一個：<strong>{nextAvailablePrize.name}</strong>（剩 {remainingSlots(nextAvailablePrize)}）</> : "—"}
        </span>
        <span className={`event-lottery-status-item ${drawLocked ? "event-lottery-status-locked" : "event-lottery-status-ready"}`}>
          {drawLocked ? "🔒 前台播放中，請稍候" : "🔓 可以抽獎"}
        </span>
        <span className="event-lottery-status-item">📱 {remoteStatusLabel}</span>
        <Link className="button button-small button-blue" href="/tools/event-lottery/stage" target="_blank" rel="noopener">開啟舞台展示 ↗</Link>
      </div>
    );
  }

  /** 分頁切換超過頁數上限的小控制條，參加者表格與尚可抽名單彈窗共用同一種樣式。 */
  function renderPager(page: number, totalPages: number, totalCount: number, onChange: (next: number) => void) {
    if (totalPages <= 1) return null;
    return (
      <div className="event-lottery-pager">
        <button className="button button-small button-secondary" type="button" onClick={() => onChange(page - 1)} disabled={page <= 1}>← 上一頁</button>
        <span className="panel-meta">第 {page}／{totalPages} 頁，共 {totalCount} 筆</span>
        <button className="button button-small button-secondary" type="button" onClick={() => onChange(page + 1)} disabled={page >= totalPages}>下一頁 →</button>
      </div>
    );
  }

  if (!hydrated) {
    return <section className="workspace event-lottery-console page-shell event-lottery-full-width" aria-label="活動抽獎控制台"><div className="panel"><p className="result-empty">載入中…</p></div></section>;
  }

  return (
    <section className="workspace event-lottery-console page-shell event-lottery-full-width" aria-label="活動抽獎控制台">
      <header className="event-lottery-admin-header">
        <h1>抽獎系統控制面板</h1>
        <div className="event-lottery-quick-actions">
          <button className="button button-small button-secondary" type="button" onClick={() => setShowHelp(true)}>📖 系統操作說明</button>
          <button className="button button-small button-blue" type="button" onClick={handleExportBackup}>📦 匯出備份</button>
          <button className="button button-small button-secondary" type="button" onClick={() => backupInputRef.current?.click()}>📥 匯入備份</button>
          <button className="button button-small button-danger" type="button" onClick={handleClearAllData}>{clearAllConfirm.armedId === "clear-all" ? "再按一次確定重置" : "重置系統資料"}</button>
          <input ref={backupInputRef} className="file-input" type="file" accept="application/json,.json" aria-label="匯入活動備份 JSON" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleImportBackup(file); event.target.value = ""; }} />
        </div>
      </header>

      {notice && <p className={`gantt-notice gantt-notice-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p>}

      {renderStatusBar()}

      <div className="event-lottery-tabs" role="tablist" aria-label="控制台分頁">
        {TABS.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} className={`button button-small ${activeTab === tab.id ? "button-blue" : "button-secondary"}`} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>
        ))}
      </div>

      {activeTab === "settings" && (
      <>
      <div className="panel event-lottery-settings-panel">
        <div className="panel-header"><h2>活動設定</h2><span className="panel-meta">共 {totalParticipantCount(state.participants)} 人 · 可抽 {availableParticipants.length} 人</span></div>
        <label className="event-lottery-field" htmlFor="event-title">前台大標題
          <div className="event-lottery-title-editor">
            <input id="event-title" className="key-input" type="text" value={eventTitleDraft} maxLength={MAX_TITLE_LENGTH} onChange={(event) => setEventTitleDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") handleUpdateEventTitle(); }} />
            <button className="button button-small button-blue" type="button" onClick={handleUpdateEventTitle}>更新</button>
          </div>
        </label>
        <div className="form-controls">
          <label className="number-field" htmlFor="reveal-mode">抽獎模式
            <select id="reveal-mode" className="key-input" value={state.revealMode} onChange={(event) => commit({ ...state, revealMode: event.target.value === "simultaneous" ? "simultaneous" : "sequential" })}>
              <option value="sequential">逐次抽出</option>
              <option value="simultaneous">一次抽出</option>
            </select>
          </label>
          <label className="number-field" htmlFor="animation-duration">抽獎動畫時間
            <input id="animation-duration" className="number-input" type="number" min={1} max={60} step={1} value={Math.round(state.animationDurationMs / 1000)} onChange={(event) => commit({ ...state, animationDurationMs: Math.min(60000, Math.max(1000, (Math.round(Number(event.target.value)) || 3) * 1000)) })} />
            <span className="field-suffix">秒</span>
          </label>
          <div className="event-lottery-sound-control">
            <span>音效開關</span>
            <label className="check-row"><input type="checkbox" checked={state.soundEnabled} onChange={(event) => commit({ ...state, soundEnabled: event.target.checked })} />開啟音效</label>
          </div>
          <div className="event-lottery-sound-control">
            <span>前台抽獎按鈕</span>
            <label className="check-row"><input type="checkbox" checked={state.stageButtonVisible} onChange={(event) => commit({ ...state, stageButtonVisible: event.target.checked })} />在舞台畫面顯示</label>
            <span className="panel-meta">關閉後仍可用鍵盤、簡報筆或手機遙控操作</span>
          </div>
        </div>
        <div className="event-lottery-background-row">
          <span className="panel-meta">前台背景</span>
          <button className="button button-small button-secondary" type="button" onClick={() => backgroundInputRef.current?.click()}>{state.backgroundImageDataUrl ? "更換背景圖片" : "上傳背景圖片"}</button>
          <button className="button button-small button-secondary" type="button" onClick={handleResetBackground}>{backgroundConfirm.armedId === "reset-background" ? "再按一次還原預設" : "還原預設"}</button>
          <input ref={backgroundInputRef} className="file-input" type="file" accept="image/*" aria-label="上傳舞台背景圖片" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleBackgroundImage(file); event.target.value = ""; }} />
        </div>
      </div>

      {!supabaseConfigured ? (
        <div className="panel event-lottery-remote-panel event-lottery-remote-panel-collapsed" aria-label="手機遙控">
          <span className="panel-meta">📱 手機遙控（選填功能，不影響本機抽獎）：尚未設定手機遙控服務</span>
        </div>
      ) : (
      <div className="panel event-lottery-remote-panel" aria-label="手機遙控">
        <div className="panel-header"><h2>手機遙控</h2><span className="panel-meta">選填功能，不影響本機抽獎</span></div>
        {!remoteSession && (
          <div className="event-lottery-quick-actions">
            <button className="button button-blue" type="button" onClick={handleEnableRemote} disabled={remoteBusy}>{remoteBusy ? "啟用中…" : "啟用手機遙控"}</button>
          </div>
        )}
        {remoteSession && (
          <div className="event-lottery-remote-qr">
            {remoteQrDataUrl && !remotePaired && <img src={remoteQrDataUrl} alt="手機遙控配對 QR Code，用手機相機掃描後直接進入遙控頁" />}
            <div className="event-lottery-remote-qr-meta">
              {!remotePaired && <p>{remoteQrDataUrl ? "等待手機掃描…" : "已建立 session；控制台重新整理過就無法再顯示 QR Code，請撤銷後重新啟用"}</p>}
              {remotePaired && <p><strong>{remotePairedStale ? "手機可能已離線" : "已配對"}</strong></p>}
              <p>Session 到期時間：{new Date(remoteSession.expiresAt).toLocaleString("zh-TW", { hour12: false })}</p>
              <div className="event-lottery-quick-actions">
                <button className="button button-small button-danger" type="button" onClick={handleRevokeRemote} disabled={remoteBusy}>撤銷手機遙控</button>
              </div>
            </div>
          </div>
        )}
        {remoteNotice && <p className={`gantt-notice gantt-notice-${remoteNotice.tone}`} role={remoteNotice.tone === "error" ? "alert" : "status"}>{remoteNotice.text}</p>}
      </div>
      )}
      </>
      )}

      {activeTab === "roster" && (
          <section id="event-lottery-rosters" className="panel" aria-label="名單與參加者">
          <div className="panel-header"><h2>名單與參加者</h2><span className="panel-meta">共 {totalParticipantCount(state.participants)} 人 · 可抽 {availableParticipants.length} 人</span></div>
          <div className="event-lottery-stat-badges">
            <span className="event-lottery-stat-badge">總人數: {totalParticipantCount(state.participants)}</span>
            <button className="event-lottery-stat-badge event-lottery-stat-badge-clickable" type="button" onClick={() => setShowRemainingRoster(true)} title="點擊查看剩餘名單明細">尚可抽: {availableParticipants.length}</button>
          </div>
          <div className="event-lottery-group-breakdown">
            {state.rosters.map((roster) => <span className="event-lottery-group-badge" key={roster.id}>{roster.name}: {availableParticipants.filter((participant) => participant.rosterId === roster.id).length}</span>)}
          </div>
          <div className="event-lottery-inline-form">
            <input className="key-input" type="text" placeholder="新名單群組名稱，例如：內場員工" value={newRosterName} maxLength={MAX_NAME_LENGTH} onChange={(event) => setNewRosterName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") handleAddRoster(); }} />
            <button className="button button-small button-blue" type="button" onClick={handleAddRoster} disabled={!newRosterName.trim() || state.rosters.length >= MAX_ROSTERS}>＋ 新增群組</button>
          </div>
          {renderRosterCards()}

          <div className="event-lottery-subsection">
            <h3>手動新增參加者</h3>
            <div className="event-lottery-inline-form">
              <input className="key-input" type="text" placeholder="部門（可空白）" value={manualDepartment} maxLength={MAX_NAME_LENGTH} onChange={(event) => setManualDepartment(event.target.value)} />
              <input className="key-input" type="text" placeholder="姓名 *" value={manualName} maxLength={MAX_NAME_LENGTH} onChange={(event) => setManualName(event.target.value)} />
              <input className="key-input" type="text" placeholder="員工編號 *" value={manualEmployeeId} maxLength={MAX_NAME_LENGTH} onChange={(event) => setManualEmployeeId(event.target.value)} />
              <select className="key-input" value={effectiveManualRosterId} onChange={(event) => setManualRosterId(event.target.value)} aria-label="加入名單群組">
                {state.rosters.map((roster) => <option key={roster.id} value={roster.id}>{roster.name}</option>)}
              </select>
              <button className="button button-small button-blue" type="button" onClick={handleAddParticipant} disabled={state.rosters.length === 0}>＋ 新增</button>
            </div>
          </div>

          <div className="event-lottery-subsection">
            <h3>CSV 匯入</h3>
            <p className="lottery-panel-note">欄位：部門,姓名,員工編號（可含標題列，也支援自訂欄位順序）。自動辨識 UTF-8／Big5／Windows-1252 編碼。重複員工編號會先確認；同一名單會更新，跨名單則依確認結果新增。{participantCsvDetectedEncoding && <span>本次讀取：{encodingLabel(participantCsvDetectedEncoding)}</span>}</p>
            <div className="event-lottery-inline-form">
              <select className="key-input" value={effectiveCsvRosterId} onChange={(event) => setCsvRosterId(event.target.value)} aria-label="CSV 匯入到哪個名單群組">
                {state.rosters.map((roster) => <option key={roster.id} value={roster.id}>{roster.name}</option>)}
              </select>
              <select className="key-input" value={participantCsvEncoding} onChange={(event) => setParticipantCsvEncoding(event.target.value as TextEncodingPreference)} aria-label="CSV 編碼">
                <option value="auto">自動偵測</option>
                <option value="utf-8">UTF-8</option>
                <option value="big5">Big5／ANSI 繁中</option>
                <option value="windows-1252">Windows-1252／ANSI 西文</option>
              </select>
              <button className="button button-small button-secondary" type="button" onClick={() => csvFileInputRef.current?.click()} disabled={state.rosters.length === 0}>選擇 CSV 檔案</button>
              <input ref={csvFileInputRef} className="file-input" type="file" accept="text/csv,.csv" aria-label="選擇參加者 CSV 檔案" onChange={(event) => setParticipantCsvFile(event.target.files?.[0] ?? null)} />
              <span className="panel-meta" title={participantCsvFile?.name}>{participantCsvFile?.name ?? "尚未選擇檔案"}</span>
              <button className="button button-small button-blue" type="button" onClick={() => void uploadParticipantCsv()} disabled={!participantCsvFile || state.rosters.length === 0}>上傳</button>
              <button className="button button-small button-secondary" type="button" onClick={() => downloadCsvTemplate(PARTICIPANT_CSV_TEMPLATE, "人員名單範例.csv")}>📥 下載人員名單範例</button>
            </div>
            <textarea className="participant-input" placeholder={"或直接貼上 CSV 內容\n部門,姓名,員工編號\n業務部,小明,E001"} value={csvText} onChange={(event) => setCsvText(event.target.value)} />
            <button className="button button-small button-secondary" type="button" onClick={() => applyParticipantCsv(csvText)} disabled={!csvText.trim() || state.rosters.length === 0}>匯入貼上的內容</button>
          </div>

          <div className="event-lottery-subsection">
            <div className="event-lottery-inline-form">
              <span className="panel-meta">篩選群組</span>
              <select className="key-input" value={participantFilterRosterId} onChange={(event) => setParticipantFilterRosterId(event.target.value)} aria-label="篩選顯示的名單群組">
                <option value="all">全部群組</option>
                {state.rosters.map((roster) => <option key={roster.id} value={roster.id}>{roster.name}</option>)}
              </select>
              <button className="button button-small button-secondary" type="button" onClick={() => setShowRemainingRoster(true)}>📋 尚可抽人員明細</button>
            </div>
            {visibleParticipants.length === 0
              ? <p className="result-empty"><strong>還沒有參加者</strong>用上方表單新增，或匯入 CSV。</p>
              : <>
                <div className="csv-table-scroll"><table className="csv-table event-lottery-table">
                  <thead><tr><th>部門</th><th>姓名</th><th>員工編號</th><th>名單群組</th><th>狀態</th><th></th></tr></thead>
                  <tbody>
                    {paginatedParticipants.map((participant: EventParticipant) => (
                      <tr key={participant.id}>
                        <td>{participant.department}</td>
                        <td>{participant.name}</td>
                        <td>{participant.employeeId}</td>
                        <td>{rosterById.get(participant.rosterId)?.name ?? "—"}</td>
                        <td><button className="button button-small button-secondary" type="button" onClick={() => handleToggleActive(participant.id)}>{participant.active ? "有效" : "已停用"}</button></td>
                        <td><button className="button button-small button-danger" type="button" onClick={() => handleDeleteParticipant(participant.id)}>{participantConfirm.armedId === participant.id ? "確定？" : "刪除"}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                {renderPager(participantPageClamped, participantTotalPages, visibleParticipants.length, setParticipantPage)}
                </>}
          </div>
          </section>
      )}

      {activeTab === "draw" && (
          <section id="event-lottery-draw" className="panel panel-tinted" aria-label="控制面板">
          <div className="panel-header"><h2>控制面板</h2></div>
          {orderedPrizes.length === 0
            ? <p className="result-empty"><strong>還沒有獎項</strong>請先到「獎項管理」新增至少一個獎項。</p>
            : <>
                {drawLocked && <p className="gantt-notice gantt-notice-info">{noticeLocked ? "前台正在顯示重抽提示，請稍候…" : previewLocked ? "前台正在播放歷史得獎名單，請稍候…" : "上一輪還在舞台上揭曉中，請稍候再開始下一輪（可以按「清除舞台顯示」提前中止）"}</p>}
                <div className="event-lottery-draw-hints">
                  <p className="event-lottery-draw-hint event-lottery-draw-hint-success">🎁 {remainingPrizes.length > 0 ? <>剩餘 <strong>{remainingPrizes.length}</strong> 個獎項，共 <strong>{remainingPrizeSlots}</strong> 個名額未抽出</> : "所有獎項皆已抽完！"}</p>
                  <p className="event-lottery-draw-hint event-lottery-draw-hint-warning">
                    👉 下一個預定抽獎：{nextAvailablePrize
                      ? <><span>第 {orderedPrizes.indexOf(nextAvailablePrize) + 1} 個 — {nextAvailablePrize.name}</span>（剩 {remainingSlots(nextAvailablePrize)} 個）<small>※ 您可直接在下方切換其他獎項，或依照系統順序往下抽。</small></>
                      : remainingPrizes.length > 0 ? "目前沒有符合資格的人員" : "目前所有獎項皆已抽完！"}
                  </p>
                </div>
                <div className="event-lottery-inline-form">
                  <label className="number-field" htmlFor="draw-prize">選擇獎項
                    <select id="draw-prize" className="key-input" value={effectiveDrawPrizeId} disabled={drawLocked} onChange={(event) => handleSelectDrawPrize(event.target.value)}>
                      <option value="">請選擇抽獎獎項...</option>
                      {orderedPrizes.filter((prize) => remainingSlots(prize) > 0).map((prize) => <option key={prize.id} value={prize.id}>{orderedPrizes.indexOf(prize) + 1}. {prize.name}（剩餘 {remainingSlots(prize)}）</option>)}
                    </select>
                  </label>
                  <label className="number-field" htmlFor="draw-count">本輪抽出人數
                    <input id="draw-count" className="number-input" type="number" min={1} max={Math.max(1, drawRemaining)} value={state.stageDrawCount} disabled={drawLocked} onChange={(event) => handleStageDrawCountChange(Number(event.target.value))} />
                  </label>
                </div>
                {drawTargetPrize && <p className="panel-meta">符合資格的候選人：{drawCandidates.length} 位 · 獎項剩餘名額：{drawRemaining} 個</p>}
                <div className="event-lottery-quick-actions">
                  <button className="button button-secondary" type="button" onClick={handlePrepareStage} disabled={drawLocked || !drawTargetPrize}>同步顯示於前台</button>
                  <button className="button button-blue draw-button" type="button" onClick={handleStartDraw} disabled={drawLocked || !drawTargetPrize || drawRemaining === 0}>{drawLocked ? "抽選中…" : "強制開始抽獎"}</button>
                  <button className="button button-secondary" type="button" onClick={handleClearStage}>清除舞台顯示</button>
                  <button className="button button-danger" type="button" onClick={handleResetEvent}>{resetConfirm.armedId === "reset" ? "再按一次確定重置" : "重置抽獎進度"}</button>
                </div>
              </>}
          </section>
      )}

      {activeTab === "prizes" && (
          <section id="event-lottery-prizes" className="panel" aria-label="獎項設定與清單">
          <div className="panel-header"><h2>獎項設定與清單</h2><span className="panel-meta">{state.prizes.length} / {MAX_PRIZES} 項</span></div>

          <div className="event-lottery-subsection">
            <h3>手動新增獎項</h3>
            <div className="event-lottery-inline-form">
              <input className="key-input" type="text" placeholder="獎項名稱" value={prizeName} maxLength={MAX_NAME_LENGTH} onChange={(event) => setPrizeName(event.target.value)} />
              <label className="number-field" htmlFor="prize-count">總數量
                <input id="prize-count" className="number-input" type="number" min={1} value={prizeCount} onChange={(event) => setPrizeCount(Math.max(1, Math.round(Number(event.target.value)) || 1))} />
              </label>
              <label className="number-field" htmlFor="prize-insert-after">接在此順序後（選填）
                <input id="prize-insert-after" className="number-input" type="number" min={1} value={prizeInsertAfter} onChange={(event) => setPrizeInsertAfter(event.target.value)} />
              </label>
              <span className="event-lottery-upload-label">上傳獎品圖片:</span>
              <button id="new-prize-image" className="button button-small button-secondary" type="button" onClick={() => newPrizeImageInputRef.current?.click()}>{prizeImageDataUrl ? "更換獎品圖片" : "上傳獎品圖片"}</button>
              <input ref={newPrizeImageInputRef} className="file-input" type="file" accept="image/*" aria-label="上傳新獎項的獎品圖片" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleNewPrizeImage(file); event.target.value = ""; }} />
              <label className="check-row"><input type="checkbox" checked={prizeAllowRepeat} onChange={(event) => setPrizeAllowRepeat(event.target.checked)} />全員重抽</label>
              <button className="button button-small button-blue" type="button" onClick={handleAddPrize}>手動新增獎項</button>
            </div>
            <fieldset className="event-lottery-roster-checks">
              <legend>可參加的名單群組（至少選擇一個）</legend>
              {state.rosters.map((roster) => (
                <label className="check-row" key={roster.id}>
                  <input type="checkbox" checked={effectivePrizeRosterIds.includes(roster.id)} onChange={(event) => togglePrizeRosterSelection(roster.id, event.target.checked)} />
                  {roster.name}
                </label>
              ))}
            </fieldset>
          </div>

          <div className="event-lottery-subsection">
            <h3>批次匯入:</h3>
            <p className="lottery-panel-note">欄位：抽獎順序,獎項,數量；自動辨識 UTF-8／Big5／Windows-1252 編碼。CSV 會套用下方勾選的對象名單。{prizeCsvDetectedEncoding && <span>本次讀取：{encodingLabel(prizeCsvDetectedEncoding)}</span>}</p>
            <div className="event-lottery-inline-form">
              <select className="key-input" value={prizeCsvEncoding} onChange={(event) => setPrizeCsvEncoding(event.target.value as TextEncodingPreference)} aria-label="獎項 CSV 編碼">
                <option value="auto">自動偵測</option>
                <option value="utf-8">UTF-8</option>
                <option value="big5">Big5／ANSI 繁中</option>
                <option value="windows-1252">Windows-1252／ANSI 西文</option>
              </select>
              <button className="button button-small button-secondary" type="button" onClick={() => prizeCsvFileInputRef.current?.click()}>選擇獎項 CSV</button>
              <input ref={prizeCsvFileInputRef} className="file-input" type="file" accept="text/csv,.csv" aria-label="選擇獎項 CSV 檔案" onChange={(event) => setPrizeCsvFile(event.target.files?.[0] ?? null)} />
              <span className="panel-meta" title={prizeCsvFile?.name}>{prizeCsvFile?.name ?? "尚未選擇檔案"}</span>
              <span className="event-lottery-upload-label">上傳獎項清單CSV:</span>
              <button id="prize-csv-upload-button" className="button button-small button-blue" type="button" onClick={() => void uploadPrizeCsv()} disabled={!prizeCsvFile}>上傳獎項 CSV</button>
              <button className="button button-small button-secondary" type="button" onClick={() => downloadCsvTemplate(PRIZE_CSV_TEMPLATE, "獎品項目清單範例.csv")}>📥 下載獎品項目清單範例</button>
            </div>
            <fieldset className="event-lottery-roster-checks">
              <legend>CSV 匯入對象名單</legend>
              {state.rosters.map((roster) => (
                <label className="check-row" key={roster.id}>
                  <input type="checkbox" checked={effectivePrizeCsvRosterIds.includes(roster.id)} onChange={(event) => togglePrizeCsvRosterSelection(roster.id, event.target.checked)} />
                  {roster.name}
                </label>
              ))}
            </fieldset>
            <textarea className="participant-input" placeholder={"或直接貼上 CSV 內容\n名稱,總數量\n三獎,5"} value={prizeCsvText} onChange={(event) => setPrizeCsvText(event.target.value)} />
            <button className="button button-small button-secondary" type="button" onClick={() => applyPrizeCsv(prizeCsvText)} disabled={!prizeCsvText.trim()}>匯入貼上的內容</button>
          </div>

          {orderedPrizes.length === 0
            ? <p className="result-empty"><strong>還沒有獎項</strong>用上方表單新增，或匯入 CSV。</p>
            : <>
                <div className="event-lottery-prize-list-head" aria-hidden="true">
                  <span />
                  <span>#</span>
                  <span>獎項名稱</span>
                  <span>已抽/總數</span>
                  <span>對象名單</span>
                  <span>允許全員重抽</span>
                  <span>圖片 (可拖曳)</span>
                  <span>操作</span>
                </div>
                <ul className="event-lottery-prize-list">
                {orderedPrizes.map((prize, index) => (
                  <li
                    key={prize.id}
                    className={`event-lottery-prize-row${dragOverPrizeId === prize.id ? " event-lottery-prize-row-dragover" : ""}`}
                    draggable
                    onDragStart={() => { dragPrizeIdRef.current = prize.id; }}
                    onDragOver={(event) => { event.preventDefault(); setDragOverPrizeId(prize.id); handlePrizeDragOver(prize.id); }}
                    onDragEnd={() => { dragPrizeIdRef.current = null; setDragOverPrizeId(null); }}
                    onDrop={(event) => event.preventDefault()}
                  >
                    <span className="event-lottery-prize-drag-handle" aria-hidden="true">☰</span>
                    <span className="event-lottery-prize-order" aria-label={`第 ${index + 1} 項`}>{index + 1}</span>
                    <div className="event-lottery-prize-name">
                      <input key={`${prize.id}:${prize.name}`} className="key-input" type="text" defaultValue={prize.name} maxLength={MAX_NAME_LENGTH} onBlur={(event) => handleUpdatePrize(prize.id, { name: event.target.value.trim().slice(0, MAX_NAME_LENGTH) || prize.name })} aria-label={`獎項名稱：${prize.name}`} />
                    </div>
                    <div className="event-lottery-prize-qty">
                      <span className="event-lottery-prize-count"><strong>{prize.drawnCount}</strong><span aria-hidden="true">/</span>{prize.totalCount}</span>
                      <label className="number-field event-lottery-prize-edit-count">總數量
                        <input className="number-input" type="number" min={prize.drawnCount || 1} value={prize.totalCount} onChange={(event) => handleUpdatePrize(prize.id, { totalCount: Math.max(prize.drawnCount || 1, Math.round(Number(event.target.value)) || prize.totalCount) })} />
                      </label>
                      <span className="panel-meta">剩餘 {remainingSlots(prize)}</span>
                    </div>
                    <div className="event-lottery-prize-target" title="可參加的名單群組">
                      {prize.eligibleRosterIds.length === 0
                        ? "全部名單"
                        : state.rosters.filter((roster) => prize.eligibleRosterIds.includes(roster.id)).map((roster) => roster.name).join(" / ") || "—"}
                    </div>
                    <div className="event-lottery-prize-flag">
                      {prize.allowRepeatWinners
                        ? <span className="event-lottery-prize-repeat-badge">可重抽</span>
                        : <span className="event-lottery-prize-no-repeat">—</span>}
                    </div>
                    <div
                      className={`event-lottery-prize-thumb-drop${dragOverPrizeId === prize.id ? " event-lottery-prize-thumb-drop-active" : ""}`}
                      onDragOver={(event) => { event.preventDefault(); setDragOverPrizeId(prize.id); }}
                      onDragLeave={() => setDragOverPrizeId(null)}
                      onDrop={(event) => { event.preventDefault(); setDragOverPrizeId(null); const file = event.dataTransfer.files?.[0]; if (file) void handlePrizeImage(prize.id, file); }}
                      onClick={() => prizeImageInputRefs.current.get(prize.id)?.click()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          prizeImageInputRefs.current.get(prize.id)?.click();
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`上傳「${prize.name}」的圖片`}
                      title="可將圖片拖曳到這裡，或點選圖片選擇檔案"
                    >
                      {prize.imageDataUrl
                        ? <img className="event-lottery-prize-thumb" src={prize.imageDataUrl} alt="" />
                        : <span className="event-lottery-prize-thumb event-lottery-prize-thumb-empty" aria-hidden="true">🖼️<small>拖曳或<br />點選圖片</small></span>}
                    </div>
                    <div className="event-lottery-prize-actions">
                      <button className="gantt-row-delete" type="button" aria-label="往上移" disabled={index === 0} onClick={() => movePrize(prize.id, -1)}>↑</button>
                      <button className="gantt-row-delete" type="button" aria-label="往下移" disabled={index === orderedPrizes.length - 1} onClick={() => movePrize(prize.id, 1)}>↓</button>
                      <button
                        className={`button button-small ${state.stagePreview?.prizeId === prize.id ? "button-blue" : "button-secondary"}`}
                        type="button"
                        title={state.stagePreview?.prizeId === prize.id ? "停止顯示前台名單" : "顯示前台名單"}
                        aria-label={state.stagePreview?.prizeId === prize.id ? `停止顯示「${prize.name}」的前台名單` : `顯示「${prize.name}」的前台名單`}
                        onClick={() => handleShowPrizeWinners(prize.id)}
                        disabled={state.stagePreview?.prizeId !== prize.id && !state.winners.some((winner) => winner.prizeId === prize.id)}
                      >
                        {state.stagePreview?.prizeId === prize.id ? "🛑" : "👁️"}
                      </button>
                      <button className="button button-small button-secondary" type="button" onClick={() => openPrizeEditor(prize)}>編輯</button>
                      <button className="button button-small button-secondary" type="button" onClick={() => prizeImageInputRefs.current.get(prize.id)?.click()}>{prize.imageDataUrl ? "更換圖片" : "上傳圖片"}</button>
                      <input ref={(element) => { prizeImageInputRefs.current.set(prize.id, element); }} className="file-input" type="file" accept="image/*" aria-label={`上傳「${prize.name}」的圖片`} onChange={(event) => { const file = event.target.files?.[0]; if (file) void handlePrizeImage(prize.id, file); event.target.value = ""; }} />
                      <button className="button button-small button-danger" type="button" onClick={() => handleDeletePrize(prize.id)}>{prizeConfirm.armedId === prize.id ? "確定？" : "刪除"}</button>
                    </div>
                  </li>
                ))}
                </ul>
              </>}
          </section>
      )}

      {activeTab === "history" && (
          <section id="event-lottery-history" className="panel" aria-label="得獎紀錄">
          <div className="panel-header"><h2>歷史中獎紀錄</h2><span className="panel-meta">共 {state.winners.length} 筆</span></div>
          <div className="event-lottery-quick-actions">
            <button className="button button-small button-secondary" type="button" onClick={() => setShowDisqualify((current) => !current)}>顯示/關閉 取消重抽按鈕</button>
            <button className="button button-small button-secondary" type="button" onClick={handleExportWinnersCsv} disabled={state.winners.length === 0}>匯出 Excel (CSV)</button>
          </div>
          {sortedWinners.length === 0
            ? <p className="result-empty"><strong>還沒有得獎紀錄</strong>到「抽獎控制」開始第一輪抽選。</p>
            : <div className="csv-table-scroll"><table className="csv-table event-lottery-table">
                <thead><tr><th>抽取時間</th><th>獎項</th><th>部門</th><th>姓名</th><th>員工編號</th><th>狀態</th><th></th></tr></thead>
                <tbody>
                  {sortedWinners.map((winner) => (
                    <tr key={winner.id} className={winner.disqualified ? "event-lottery-row-disqualified" : undefined}>
                      <td>{formatLotteryTimestamp(winner.drawnAt)}</td>
                      <td>{prizeNameById.get(winner.prizeId) ?? "（已刪除的獎項）"}</td>
                      <td>{winner.department}</td>
                      <td>{winner.participantName}</td>
                      <td>{winner.employeeId}</td>
                      <td>{winner.disqualified ? "已取消重抽" : "得獎"}</td>
                      <td>{showDisqualify && !winner.disqualified && <button className="button button-small button-danger" type="button" onClick={() => handleDisqualify(winner.id)}>{winnerConfirm.armedId === winner.id ? "確定？" : "取消重抽"}</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>}
          </section>
      )}

      {showRemainingRoster && (
        <div className="event-lottery-modal-backdrop" role="presentation" onClick={() => setShowRemainingRoster(false)}>
          <section className="event-lottery-modal" role="dialog" aria-modal="true" aria-labelledby="remaining-roster-title" onClick={(event) => event.stopPropagation()}>
            <div className="event-lottery-modal-header">
              <h2 id="remaining-roster-title">📋 尚可抽人員明細</h2>
              <button className="button button-small button-secondary" type="button" onClick={() => setShowRemainingRoster(false)} aria-label="關閉尚可抽人員明細">×</button>
            </div>
            <div className="event-lottery-inline-form">
              <select className="key-input" value={remainingRosterFilter} onChange={(event) => setRemainingRosterFilter(event.target.value)} aria-label="篩選名單">
                <option value="all">全部名單</option>
                {state.rosters.map((roster) => <option key={roster.id} value={roster.id}>{roster.name}</option>)}
              </select>
              <input className="key-input" type="search" placeholder="搜尋姓名或員工編號…" value={remainingSearch} onChange={(event) => setRemainingSearch(event.target.value)} />
              <button className="button button-small button-secondary" type="button" onClick={handleExportRemainingCsv}>匯出 CSV</button>
            </div>
            <p className="panel-meta">顯示 {remainingParticipants.length} 人</p>
            <div className="csv-table-scroll">
              <table className="csv-table event-lottery-table">
                <thead><tr><th>部門</th><th>姓名</th><th>員工編號</th><th>名單組別</th></tr></thead>
                <tbody>
                  {paginatedRemainingParticipants.map((participant) => (
                    <tr key={participant.id}>
                      <td>{participant.department}</td>
                      <td>{participant.name}</td>
                      <td>{participant.employeeId}</td>
                      <td>{rosterById.get(participant.rosterId)?.name ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {renderPager(remainingPageClamped, remainingTotalPages, remainingParticipants.length, setRemainingPage)}
          </section>
        </div>
      )}

      {editingPrize && editingPrizeDraft && (
        <div className="event-lottery-modal-backdrop" role="presentation" onClick={closePrizeEditor}>
          <section className="event-lottery-modal event-lottery-prize-edit-modal" role="dialog" aria-modal="true" aria-labelledby="event-lottery-edit-prize-title" onClick={(event) => event.stopPropagation()}>
            <div className="event-lottery-modal-header">
              <h2 id="event-lottery-edit-prize-title">編輯獎項</h2>
              <button className="button button-small button-secondary" type="button" onClick={closePrizeEditor} aria-label="關閉編輯獎項">×</button>
            </div>
            <label className="event-lottery-edit-field">名稱
              <input className="key-input" type="text" value={editingPrizeDraft.name} maxLength={MAX_NAME_LENGTH} onChange={(event) => setEditingPrizeDraft((current) => current ? { ...current, name: event.target.value } : current)} />
            </label>
            <label className="event-lottery-edit-field">數量
              <input className="number-input" type="number" min={editingPrize.drawnCount || 1} value={editingPrizeDraft.totalCount} onChange={(event) => setEditingPrizeDraft((current) => current ? { ...current, totalCount: Math.max(editingPrize.drawnCount, Math.round(Number(event.target.value)) || current.totalCount) } : current)} />
            </label>
            <fieldset className="event-lottery-roster-checks">
              <legend>對象名單</legend>
              {state.rosters.map((roster) => (
                <label className="check-row" key={roster.id}>
                  <input
                    type="checkbox"
                    checked={editingPrizeDraft.eligibleRosterIds.includes(roster.id)}
                    onChange={(event) => setEditingPrizeDraft((current) => {
                      if (!current) return current;
                      const next = event.target.checked
                        ? [...current.eligibleRosterIds.filter((id) => id !== roster.id), roster.id]
                        : current.eligibleRosterIds.filter((id) => id !== roster.id);
                      if (next.length === 0 && state.rosters.length > 0) {
                        showNotice("最少必須選擇一個抽獎對象名單", "error");
                        return current;
                      }
                      return { ...current, eligibleRosterIds: next };
                    })}
                  />
                  {roster.name}
                </label>
              ))}
            </fieldset>
            <label className="check-row event-lottery-edit-repeat"><input type="checkbox" checked={editingPrizeDraft.allowRepeatWinners} onChange={(event) => setEditingPrizeDraft((current) => current ? { ...current, allowRepeatWinners: event.target.checked } : current)} />🚩 允許全員重抽(不排除已中獎者)</label>
            <div className="event-lottery-quick-actions event-lottery-edit-actions">
              <button className="button button-danger" type="button" onClick={closePrizeEditor}>取消</button>
              <button className="button button-blue" type="button" onClick={savePrizeEditor}>儲存變更</button>
            </div>
          </section>
        </div>
      )}

      {showHelp && (
        <div className="event-lottery-modal-backdrop" role="presentation" onClick={() => setShowHelp(false)}>
          <section className="event-lottery-modal event-lottery-help-modal" role="dialog" aria-modal="true" aria-labelledby="event-lottery-help-title" onClick={(event) => event.stopPropagation()}>
            <div className="event-lottery-modal-header">
              <h2 id="event-lottery-help-title">📖 抽獎系統操作說明</h2>
              <button className="button button-small button-secondary" type="button" onClick={() => setShowHelp(false)} aria-label="關閉操作說明">×</button>
            </div>
            <h3>一、事前準備 (資料匯入)</h3>
            <p>1. <strong>匯入人員名單</strong>：切到「名單與參加者」分頁上傳 CSV 檔（預設提供 A/B/C 三組名單）。編碼會自動辨識 UTF-8／Big5／Windows-1252，也可以手動指定，<strong>避免產生亂碼</strong>。</p>
            <p>2. <strong>設定獎項與圖片</strong>：切到「獎項管理」分頁手動新增獎項，或批次匯入 CSV 檔。您可以直接在獎項表格中點選名稱進行<strong>快速修改</strong>，也可以從資料夾將圖片直接<strong>拖曳</strong>進入表格的「圖片(可拖曳)」欄位。</p>
            <p>3. <strong>獎項排序</strong>：在獎項清單中，按住獎項左側的「☰」符號上下拖曳，即可調整抽獎順序；系統會自動存檔，也可以在新增時指定接在第幾項後。</p>
            <h3>二、抽獎設定與同步</h3>
            <p>1. <strong>選擇抽獎模式</strong>：在上方控制列選擇「逐次抽出」（動畫一張一張翻出）或「一次抽出」（依據設定的<strong>抽獎動畫時間</strong>滾動後一次全開）。有音效需求也可在此開啟。</p>
            <p>2. <strong>準備畫面</strong>：確認控制視窗有選到前台的視窗，會看到最上方前台大標題在閃爍，代表已可進行抽獎，系統即會按照匯入獎項名單順序抽出。若有要臨時改抽後續某個獎項，可在「抽獎控制」選擇獎項並點擊<strong>同步顯示於前台</strong>；若前台螢幕有開啟，此時會切換至該獎項的「即將抽出」預備畫面，上方的黃底提示也會即時更新目前的預定進度。</p>
            <p>3. <strong>前台快捷操控</strong>：可以直接在擁有前台大螢幕的電腦上按下<strong>空白鍵 / PageDown / 鍵盤方向鍵右鍵</strong>來觸發開獎（也支援 Enter、畫面下方的<strong>開始抽獎按鈕</strong>、投影筆與手機遙控）。前台畫面不會因為點擊背景其他地方而誤觸，只有按鈕、鍵盤、投影筆與手機遙控才會觸發下一步。前台支援<strong>智慧順序記憶</strong>，即使中途從後台跳著開獎，也會自動找到下一個尚未開出的獎項。</p>
            <h3>三、突發狀況與歷史紀錄</h3>
            <p>1. <strong>取消重抽</strong>：若有人不在現場或要捐出來重抽，請在「歷史中獎紀錄」點選<strong>顯示/關閉 取消重抽按鈕</strong>後，點擊該名旁邊的<strong>取消重抽</strong>。前台會顯示「感謝無私奉獻」3 秒，保留取消重抽的歷史紀錄並歸還一個獎項名額，隨後自動切換至重抽 1 人的畫面！</p>
            <p>2. <strong>重新顯示名單</strong>：若不小心切到了其他畫面，可隨時在「獎項管理」分頁的獎項表格點擊<strong>👁️</strong>（顯示名單）按鈕，前台將立即調閱並切回該獎項的歷史中獎名單。</p>
            <p>3. <strong>極端大量名單展示</strong>：系統自帶智慧縮排，可將大量中獎卡片集中於同一畫面。當您一次抽出超過預設排版數量時，前台螢幕會在 1 秒後<strong>自動啟動平滑來回捲動 (Auto-Scroll)</strong>，確保所有的名單能自動播放被看見。</p>
            <h3>四、系統備份與還原</h3>
            <p>1. <strong>📦 匯出備份</strong>：按右上角的按鈕，系統會將一切資料打包為單一的 <code>.json</code> 檔案下載。<strong>備份範圍包含</strong>：手動輸入的大標題、抽獎模式與自訂動畫秒數、所有人員名單、所有設定好的獎項與其對應的圖片、抽獎歷史結果、取消資格紀錄，甚至是自訂的前台背景底圖。一鍵帶走，支援跨電腦轉移。</p>
            <p>2. <strong>📥 匯入備份</strong>：點選匯入並選擇上述產生的備份檔，系統便會瞬間復原到該份記錄的完整進度，包含那些已經被抽走的名額與紀錄，適合活動當天更換硬體設備時無縫接軌。</p>
            <p>3. <strong>🛑 重置系統資料</strong>：點擊後會把上述「所有」的系統資料一次大洗白，包含所有狀態回到預設值。（警告：此操作不可逆，建議於彩排結束或來年新活動前操作）。</p>
          </section>
        </div>
      )}
    </section>
  );
}
