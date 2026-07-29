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
  disqualifyWinner,
  eligibleParticipantCount,
  eventBackupFileName,
  exportEventBackup,
  findDuplicateEmployeeId,
  MAX_DRAW_COUNT_PER_ROUND,
  MAX_IMAGE_DATA_URL_LENGTH,
  MAX_NAME_LENGTH,
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
  generatePairingToken,
  isRemoteSessionUsable,
  sanitizeStoredRemoteSessionPointer,
  type StoredRemoteSessionPointer,
} from "@/lib/event-lottery-remote";
import { connectRemoteChannel, ensureAnonymousSession, type RemoteChannelHandle } from "@/lib/event-lottery-remote-channel";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase-browser";
import { clearStageAction, prepareStage, startDraw } from "./actions";
import { loadEventState, saveEventState, useEventLotterySync, type EventLotterySyncMessage } from "./sync";

type TabId = "rosters" | "participants" | "prizes" | "draw" | "history";
const TABS: Array<{ id: TabId; label: string }> = [
  { id: "rosters", label: "名單群組" },
  { id: "participants", label: "參加者管理" },
  { id: "prizes", label: "獎項管理" },
  { id: "draw", label: "抽獎控制" },
  { id: "history", label: "得獎紀錄" },
];

type Notice = { text: string; tone: "info" | "error" };

/** 舞台沒有回報 DRAW_FINISHED（例如舞台分頁根本沒開）時，控制台最多等理論播完
 *  時間之後再加這麼多毫秒就自動解鎖，避免永久鎖死。 */
const DRAW_LOCK_FALLBACK_MARGIN_MS = 8000;

/** CSV 匯入格式容易猜錯，提供範例檔案讓使用者照著填，而不是只靠文字說明。 */
const PARTICIPANT_CSV_TEMPLATE = "姓名,員工編號,部門\r\n王小明,E001,業務部\r\n林小美,E002,行銷部\r\n";
const PRIZE_CSV_TEMPLATE = "名稱,總數量,允許已得獎者再次參加,適用名單\r\n三獎,5,,\r\n特獎,1,是,\r\n";

function downloadCsvTemplate(content: string, filename: string) {
  downloadBlob(new Blob([`﻿${content}`], { type: "text/csv;charset=utf-8" }), filename);
}

/** 圖片上傳一律先縮圖再存進 localStorage：避免單張圖片就把容量塞爆。 */
async function resizeImageToDataUrl(file: File, maxEdge = 900, quality = 0.85): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("請選擇圖片檔案");
  if (file.size > 15 * 1024 * 1024) throw new Error("圖片檔案過大，上限 15MB");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("這個瀏覽器不支援圖片處理");
    context.drawImage(bitmap, 0, 0, width, height);
    let currentQuality = quality;
    let dataUrl = canvas.toDataURL("image/jpeg", currentQuality);
    while (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH && currentQuality > 0.3) {
      currentQuality -= 0.15;
      dataUrl = canvas.toDataURL("image/jpeg", currentQuality);
    }
    if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) throw new Error("圖片處理後仍太大，請換一張較小的圖片");
    return dataUrl;
  } finally {
    bitmap.close();
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
  const [tab, setTab] = useState<TabId>("rosters");
  const [notice, setNotice] = useState<Notice | null>(null);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(loadEventState());
    setHydrated(true);
  }, []);

  function showNotice(text: string, tone: Notice["tone"] = "info") {
    setNotice({ text, tone });
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
      if (message.type === "REMOTE_HELLO") setRemotePairedAt(Date.now());
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
    if (!pending || ackedDrawIds.has(pending.drawId)) return;
    const interval = setInterval(() => setNowTick(Date.now()), 250);
    return () => clearInterval(interval);
    // 刻意只依賴 drawId／revealAt 兩個原始值，不用整個 pendingReveal 物件：其他跟
    // 這一輪無關的變更（重新讀取狀態等）不該讓這個計時器重新啟動。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pendingReveal?.drawId, state.pendingReveal?.revealAt, ackedDrawIds]);

  // 解鎖優先看舞台的 DRAW_FINISHED 回報；如果舞台分頁根本沒開、或訊息漏接，
  // 用「理論播完時間 + 安全緩衝」當備援，避免控制台永遠鎖死。
  const pendingReveal = state.pendingReveal;
  const pendingAcked = pendingReveal !== null && ackedDrawIds.has(pendingReveal.drawId);
  const drawLocked = pendingReveal !== null && !pendingAcked && nowTick < pendingRevealCompleteAt(pendingReveal) + DRAW_LOCK_FALLBACK_MARGIN_MS;

  const rosterConfirm = useArmedConfirm();
  const participantConfirm = useArmedConfirm();
  const prizeConfirm = useArmedConfirm();
  const winnerConfirm = useArmedConfirm();
  const resetConfirm = useArmedConfirm();
  const clearAllConfirm = useArmedConfirm();

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
      commit(createEmptyEventState());
      showNotice("已清除所有資料");
    });
  }

  async function handleBackgroundImage(file: File) {
    try {
      const dataUrl = await resizeImageToDataUrl(file, 1600, 0.82);
      commit({ ...state, backgroundImageDataUrl: dataUrl });
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "圖片處理失敗", "error");
    }
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
      commit({
        ...state,
        rosters: state.rosters.filter((roster) => roster.id !== id),
        participants: state.participants.filter((participant) => participant.rosterId !== id),
        prizes: state.prizes.map((prize) => ({ ...prize, eligibleRosterIds: prize.eligibleRosterIds.filter((rid) => rid !== id) })),
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
  const [csvText, setCsvText] = useState("");
  const csvFileInputRef = useRef<HTMLInputElement>(null);

  const firstRosterId = state.rosters[0]?.id ?? "";
  const effectiveManualRosterId = state.rosters.some((roster) => roster.id === manualRosterId) ? manualRosterId : firstRosterId;
  const effectiveCsvRosterId = state.rosters.some((roster) => roster.id === csvRosterId) ? csvRosterId : firstRosterId;

  function handleAddParticipant() {
    const name = manualName.trim();
    if (!name) { showNotice("請輸入姓名", "error"); return; }
    if (!effectiveManualRosterId) { showNotice("請先建立至少一個名單群組", "error"); return; }
    const duplicate = findDuplicateEmployeeId(state.participants, manualEmployeeId);
    if (duplicate) { showNotice(`員工編號「${manualEmployeeId.trim()}」已用於「${duplicate.name}」，未加入`, "error"); return; }
    if (state.participants.length >= MAX_PARTICIPANTS) { showNotice(`最多只能有 ${MAX_PARTICIPANTS} 位參加者`, "error"); return; }
    commit({ ...state, participants: [...state.participants, createParticipant({ name, employeeId: manualEmployeeId, department: manualDepartment, rosterId: effectiveManualRosterId })] });
    setManualName(""); setManualEmployeeId(""); setManualDepartment("");
    showNotice(`已新增「${name}」`);
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

  function applyParticipantCsv(text: string) {
    if (!effectiveCsvRosterId) { showNotice("請先選擇要匯入到哪個名單群組", "error"); return; }
    const { rows, warnings } = parseParticipantsCsv(text);
    if (rows.length === 0) { showNotice("這份 CSV 沒有可用的資料列", "error"); return; }
    const result = mergeParticipantsFromCsv(state.participants, rows, effectiveCsvRosterId);
    commit({ ...state, participants: result.participants });
    const messages = [`已匯入 ${result.added} 位`];
    if (warnings.length > 0) messages.push(...warnings);
    if (result.skipped.length > 0) messages.push(`略過 ${result.skipped.length} 位重複員工編號：${result.skipped.slice(0, 5).join("、")}${result.skipped.length > 5 ? "…" : ""}`);
    showNotice(messages.join("；"), result.skipped.length > 0 || warnings.length > 0 ? "error" : "info");
    setCsvText("");
  }

  async function handleCsvFile(file: File) {
    try {
      applyParticipantCsv(await file.text());
    } catch {
      showNotice("讀取 CSV 檔案失敗", "error");
    }
  }

  const rosterById = useMemo(() => new Map(state.rosters.map((roster) => [roster.id, roster])), [state.rosters]);
  const visibleParticipants = useMemo(
    () => (participantFilterRosterId === "all" ? state.participants : state.participants.filter((participant) => participant.rosterId === participantFilterRosterId)),
    [state.participants, participantFilterRosterId],
  );

  // ---- 獎項管理 ----
  const [prizeName, setPrizeName] = useState("");
  const [prizeCount, setPrizeCount] = useState(1);
  const [prizeAllowRepeat, setPrizeAllowRepeat] = useState(false);
  const [prizeRosterIds, setPrizeRosterIds] = useState<string[]>([]);
  const [prizeCsvText, setPrizeCsvText] = useState("");
  const prizeCsvFileInputRef = useRef<HTMLInputElement>(null);
  const prizeImageInputRefs = useRef(new Map<string, HTMLInputElement | null>());
  const dragPrizeIdRef = useRef<string | null>(null);
  const [dragOverPrizeId, setDragOverPrizeId] = useState<string | null>(null);

  const orderedPrizes = useMemo(() => [...state.prizes].sort((a, b) => a.order - b.order), [state.prizes]);

  function handleAddPrize() {
    const name = prizeName.trim();
    if (!name) { showNotice("請輸入獎項名稱", "error"); return; }
    if (state.prizes.length >= MAX_PRIZES) { showNotice(`最多只能有 ${MAX_PRIZES} 個獎項`, "error"); return; }
    const order = state.prizes.length > 0 ? Math.max(...state.prizes.map((prize) => prize.order)) + 1 : 0;
    commit({ ...state, prizes: [...state.prizes, createPrize({ name, totalCount: prizeCount, eligibleRosterIds: prizeRosterIds, allowRepeatWinners: prizeAllowRepeat, order })] });
    setPrizeName(""); setPrizeCount(1); setPrizeAllowRepeat(false); setPrizeRosterIds([]);
  }

  function handleUpdatePrize(id: string, patch: Partial<EventPrize>) {
    commit({ ...state, prizes: state.prizes.map((prize) => (prize.id === id ? { ...prize, ...patch } : prize)) });
  }

  function toggleEligibleRoster(prizeId: string, rosterId: string) {
    const prize = state.prizes.find((item) => item.id === prizeId);
    if (!prize) return;
    const next = prize.eligibleRosterIds.includes(rosterId)
      ? prize.eligibleRosterIds.filter((id) => id !== rosterId)
      : [...prize.eligibleRosterIds, rosterId];
    handleUpdatePrize(prizeId, { eligibleRosterIds: next });
  }

  function handleDeletePrize(id: string) {
    if (!canDeletePrize(state, id)) {
      showNotice("這個獎項已經有得獎紀錄（含失格），無法刪除，避免紀錄出現懸空引用", "error");
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
      const dataUrl = await resizeImageToDataUrl(file, 900, 0.85);
      handleUpdatePrize(id, { imageDataUrl: dataUrl });
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "圖片處理失敗", "error");
    }
  }

  function applyPrizeCsv(text: string) {
    const startOrder = state.prizes.length > 0 ? Math.max(...state.prizes.map((prize) => prize.order)) + 1 : 0;
    const { prizes, warnings } = parsePrizesCsv(text, state.rosters, startOrder);
    if (prizes.length === 0) { showNotice("這份 CSV 沒有可用的獎項資料", "error"); return; }
    commit({ ...state, prizes: [...state.prizes, ...prizes] });
    const messages = [`已匯入 ${prizes.length} 個獎項`, ...warnings];
    showNotice(messages.join("；"), warnings.length > 0 ? "error" : "info");
    setPrizeCsvText("");
  }

  async function handlePrizeCsvFile(file: File) {
    try {
      applyPrizeCsv(await file.text());
    } catch {
      showNotice("讀取 CSV 檔案失敗", "error");
    }
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

  const effectiveDrawPrizeId = orderedPrizes.some((prize) => prize.id === drawPrizeId) ? drawPrizeId : (orderedPrizes[0]?.id ?? "");
  const drawTargetPrize = orderedPrizes.find((prize) => prize.id === effectiveDrawPrizeId) ?? null;
  const drawCandidates = drawTargetPrize ? candidatePool(state, drawTargetPrize.id) : [];
  const drawRemaining = drawTargetPrize ? remainingSlots(drawTargetPrize) : 0;

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

  function handleExportWinnersCsv() {
    downloadBlob(new Blob([winnersToCsv(state)], { type: "text/csv;charset=utf-8" }), `${(state.eventTitle || "活動抽獎").replace(/[\\/:*?"<>|]/g, "")}-得獎紀錄.csv`);
  }

  if (!hydrated) {
    return <section className="workspace event-lottery-console page-shell" aria-label="活動抽獎控制台"><div className="panel"><p className="result-empty">載入中…</p></div></section>;
  }

  return (
    <section className="workspace event-lottery-console page-shell" aria-label="活動抽獎控制台">
      <div className="panel event-lottery-settings-panel">
        <div className="panel-header"><h2>活動設定</h2><span className="panel-meta">共 {totalParticipantCount(state.participants)} 人 · 可抽 {eligibleParticipantCount(state.participants)} 人</span></div>
        <label className="event-lottery-field" htmlFor="event-title">活動標題
          <input id="event-title" className="key-input" type="text" value={state.eventTitle} maxLength={MAX_NAME_LENGTH} onChange={(event) => commit({ ...state, eventTitle: event.target.value.slice(0, MAX_NAME_LENGTH) || "活動抽獎" })} />
        </label>
        <div className="form-controls">
          <label className="number-field" htmlFor="reveal-mode">揭曉模式
            <select id="reveal-mode" className="key-input" value={state.revealMode} onChange={(event) => commit({ ...state, revealMode: event.target.value === "simultaneous" ? "simultaneous" : "sequential" })}>
              <option value="sequential">逐一揭曉</option>
              <option value="simultaneous">一次揭曉</option>
            </select>
          </label>
          <label className="number-field" htmlFor="animation-duration">動畫時間（毫秒）
            <input id="animation-duration" className="number-input" type="number" min={800} max={15000} step={100} value={state.animationDurationMs} onChange={(event) => commit({ ...state, animationDurationMs: Math.min(15000, Math.max(800, Math.round(Number(event.target.value)) || 3200)) })} />
          </label>
          <label className="check-row"><input type="checkbox" checked={state.soundEnabled} onChange={(event) => commit({ ...state, soundEnabled: event.target.checked })} />舞台音效</label>
        </div>
        <div className="event-lottery-background-row">
          <button className="button button-small button-secondary" type="button" onClick={() => backgroundInputRef.current?.click()}>{state.backgroundImageDataUrl ? "更換舞台背景圖片" : "上傳舞台背景圖片"}</button>
          {state.backgroundImageDataUrl && <button className="button button-small button-secondary" type="button" onClick={() => commit({ ...state, backgroundImageDataUrl: null })}>移除背景圖片</button>}
          <input ref={backgroundInputRef} className="file-input" type="file" accept="image/png,image/jpeg,image/webp" aria-label="上傳舞台背景圖片" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleBackgroundImage(file); event.target.value = ""; }} />
        </div>
        <div className="event-lottery-quick-actions">
          <Link className="button button-small button-blue" href="/tools/event-lottery/stage" target="_blank" rel="noopener">開啟舞台展示 ↗</Link>
          <button className="button button-small button-secondary" type="button" onClick={handleExportBackup}>匯出活動備份</button>
          <button className="button button-small button-secondary" type="button" onClick={() => backupInputRef.current?.click()}>匯入活動備份</button>
          <input ref={backupInputRef} className="file-input" type="file" accept="application/json,.json" aria-label="匯入活動備份 JSON" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleImportBackup(file); event.target.value = ""; }} />
          <button className="button button-small button-danger" type="button" onClick={handleClearAllData}>{clearAllConfirm.armedId === "clear-all" ? "再按一次確定清除" : "清除所有資料"}</button>
        </div>
        {notice && <p className={`gantt-notice gantt-notice-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p>}
      </div>

      <div className="panel event-lottery-remote-panel" aria-label="手機遙控">
        <div className="panel-header"><h2>手機遙控</h2><span className="panel-meta">選填功能，不影響本機抽獎</span></div>
        {!supabaseConfigured && <p className="result-empty">尚未設定手機遙控服務</p>}
        {supabaseConfigured && !remoteSession && (
          <div className="event-lottery-quick-actions">
            <button className="button button-blue" type="button" onClick={handleEnableRemote} disabled={remoteBusy}>{remoteBusy ? "啟用中…" : "啟用手機遙控"}</button>
          </div>
        )}
        {supabaseConfigured && remoteSession && (
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

      <div className="event-lottery-tabs" role="tablist" aria-label="控制台分頁">
        {TABS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={`button button-small ${tab === item.id ? "button-blue" : "button-secondary"}`} onClick={() => setTab(item.id)}>{item.label}</button>
        ))}
      </div>

      {tab === "rosters" && (
        <div className="panel" role="tabpanel" aria-label="名單群組">
          <div className="panel-header"><h2>名單群組</h2><span className="panel-meta">{state.rosters.length} / {MAX_ROSTERS} 組</span></div>
          <div className="event-lottery-inline-form">
            <input className="key-input" type="text" placeholder="新名單群組名稱，例如：內場員工" value={newRosterName} maxLength={MAX_NAME_LENGTH} onChange={(event) => setNewRosterName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") handleAddRoster(); }} />
            <button className="button button-small button-blue" type="button" onClick={handleAddRoster} disabled={!newRosterName.trim() || state.rosters.length >= MAX_ROSTERS}>＋ 新增群組</button>
          </div>
          {state.rosters.length === 0
            ? <p className="result-empty"><strong>還沒有名單群組</strong>先建立至少一個群組，才能加入參加者。</p>
            : <ul className="event-lottery-roster-list">
                {state.rosters.map((roster) => {
                  const memberCount = state.participants.filter((participant) => participant.rosterId === roster.id).length;
                  return (
                    <li key={roster.id} className="event-lottery-roster-row">
                      <input className="key-input" type="text" defaultValue={roster.name} maxLength={MAX_NAME_LENGTH} onBlur={(event) => handleRenameRoster(roster.id, event.target.value)} aria-label={`名單群組名稱：${roster.name}`} />
                      <span className="panel-meta">{memberCount} 人</span>
                      <button className="button button-small button-danger" type="button" onClick={() => handleDeleteRoster(roster.id)}>{rosterConfirm.armedId === roster.id ? `再按一次刪除（含 ${memberCount} 人）` : "刪除"}</button>
                    </li>
                  );
                })}
              </ul>}
        </div>
      )}

      {tab === "participants" && (
        <div className="panel" role="tabpanel" aria-label="參加者管理">
          <div className="panel-header"><h2>參加者管理</h2><span className="panel-meta">共 {totalParticipantCount(state.participants)} 人 · 可抽 {eligibleParticipantCount(state.participants)} 人</span></div>

          <div className="event-lottery-subsection">
            <h3>手動新增</h3>
            <div className="event-lottery-inline-form">
              <input className="key-input" type="text" placeholder="姓名" value={manualName} maxLength={MAX_NAME_LENGTH} onChange={(event) => setManualName(event.target.value)} />
              <input className="key-input" type="text" placeholder="員工編號（選填）" value={manualEmployeeId} maxLength={MAX_NAME_LENGTH} onChange={(event) => setManualEmployeeId(event.target.value)} />
              <input className="key-input" type="text" placeholder="部門（選填）" value={manualDepartment} maxLength={MAX_NAME_LENGTH} onChange={(event) => setManualDepartment(event.target.value)} />
              <select className="key-input" value={effectiveManualRosterId} onChange={(event) => setManualRosterId(event.target.value)} aria-label="加入名單群組">
                {state.rosters.map((roster) => <option key={roster.id} value={roster.id}>{roster.name}</option>)}
              </select>
              <button className="button button-small button-blue" type="button" onClick={handleAddParticipant} disabled={state.rosters.length === 0}>＋ 新增</button>
            </div>
          </div>

          <div className="event-lottery-subsection">
            <h3>CSV 匯入</h3>
            <p className="lottery-panel-note">欄位：姓名,員工編號,部門（可含標題列，UTF-8）。員工編號重複的列會被略過並列出清單。</p>
            <div className="event-lottery-inline-form">
              <select className="key-input" value={effectiveCsvRosterId} onChange={(event) => setCsvRosterId(event.target.value)} aria-label="CSV 匯入到哪個名單群組">
                {state.rosters.map((roster) => <option key={roster.id} value={roster.id}>{roster.name}</option>)}
              </select>
              <button className="button button-small button-secondary" type="button" onClick={() => csvFileInputRef.current?.click()} disabled={state.rosters.length === 0}>選擇 CSV 檔案</button>
              <input ref={csvFileInputRef} className="file-input" type="file" accept="text/csv,.csv" aria-label="選擇參加者 CSV 檔案" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleCsvFile(file); event.target.value = ""; }} />
              <button className="button button-small button-secondary" type="button" onClick={() => downloadCsvTemplate(PARTICIPANT_CSV_TEMPLATE, "活動抽獎-參加者範例.csv")}>下載範例 CSV</button>
            </div>
            <textarea className="participant-input" placeholder={"或直接貼上 CSV 內容\n姓名,員工編號,部門\n小明,E001,業務"} value={csvText} onChange={(event) => setCsvText(event.target.value)} />
            <button className="button button-small button-secondary" type="button" onClick={() => applyParticipantCsv(csvText)} disabled={!csvText.trim() || state.rosters.length === 0}>匯入貼上的內容</button>
          </div>

          <div className="event-lottery-subsection">
            <div className="event-lottery-inline-form">
              <span className="panel-meta">篩選群組</span>
              <select className="key-input" value={participantFilterRosterId} onChange={(event) => setParticipantFilterRosterId(event.target.value)} aria-label="篩選顯示的名單群組">
                <option value="all">全部群組</option>
                {state.rosters.map((roster) => <option key={roster.id} value={roster.id}>{roster.name}</option>)}
              </select>
            </div>
            {visibleParticipants.length === 0
              ? <p className="result-empty"><strong>還沒有參加者</strong>用上方表單新增，或匯入 CSV。</p>
              : <div className="csv-table-scroll"><table className="csv-table event-lottery-table">
                  <thead><tr><th>姓名</th><th>員工編號</th><th>部門</th><th>名單群組</th><th>狀態</th><th></th></tr></thead>
                  <tbody>
                    {visibleParticipants.map((participant: EventParticipant) => (
                      <tr key={participant.id}>
                        <td>{participant.name}</td>
                        <td>{participant.employeeId}</td>
                        <td>{participant.department}</td>
                        <td>{rosterById.get(participant.rosterId)?.name ?? "—"}</td>
                        <td><button className="button button-small button-secondary" type="button" onClick={() => handleToggleActive(participant.id)}>{participant.active ? "有效" : "已停用"}</button></td>
                        <td><button className="button button-small button-danger" type="button" onClick={() => handleDeleteParticipant(participant.id)}>{participantConfirm.armedId === participant.id ? "確定？" : "刪除"}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>}
          </div>
        </div>
      )}

      {tab === "prizes" && (
        <div className="panel" role="tabpanel" aria-label="獎項管理">
          <div className="panel-header"><h2>獎項管理</h2><span className="panel-meta">{state.prizes.length} / {MAX_PRIZES} 項</span></div>

          <div className="event-lottery-subsection">
            <h3>新增獎項</h3>
            <div className="event-lottery-inline-form">
              <input className="key-input" type="text" placeholder="獎項名稱" value={prizeName} maxLength={MAX_NAME_LENGTH} onChange={(event) => setPrizeName(event.target.value)} />
              <label className="number-field" htmlFor="prize-count">總數量
                <input id="prize-count" className="number-input" type="number" min={1} value={prizeCount} onChange={(event) => setPrizeCount(Math.max(1, Math.round(Number(event.target.value)) || 1))} />
              </label>
              <label className="check-row"><input type="checkbox" checked={prizeAllowRepeat} onChange={(event) => setPrizeAllowRepeat(event.target.checked)} />允許已得獎者再次參加</label>
              <button className="button button-small button-blue" type="button" onClick={handleAddPrize}>＋ 新增獎項</button>
            </div>
            <fieldset className="event-lottery-roster-checks">
              <legend>可參加的名單群組（不勾選代表所有群組都可參加）</legend>
              {state.rosters.map((roster) => (
                <label className="check-row" key={roster.id}>
                  <input type="checkbox" checked={prizeRosterIds.includes(roster.id)} onChange={(event) => setPrizeRosterIds((current) => event.target.checked ? [...current, roster.id] : current.filter((id) => id !== roster.id))} />
                  {roster.name}
                </label>
              ))}
            </fieldset>
          </div>

          <div className="event-lottery-subsection">
            <h3>CSV 批次匯入</h3>
            <p className="lottery-panel-note">欄位：名稱,總數量,允許已得獎者再次參加,適用名單（以「、」分隔的群組名稱，可含標題列）。</p>
            <div className="event-lottery-inline-form">
              <button className="button button-small button-secondary" type="button" onClick={() => prizeCsvFileInputRef.current?.click()}>選擇 CSV 檔案</button>
              <input ref={prizeCsvFileInputRef} className="file-input" type="file" accept="text/csv,.csv" aria-label="選擇獎項 CSV 檔案" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handlePrizeCsvFile(file); event.target.value = ""; }} />
              <button className="button button-small button-secondary" type="button" onClick={() => downloadCsvTemplate(PRIZE_CSV_TEMPLATE, "活動抽獎-獎項範例.csv")}>下載範例 CSV</button>
            </div>
            <textarea className="participant-input" placeholder={"或直接貼上 CSV 內容\n名稱,總數量\n三獎,5"} value={prizeCsvText} onChange={(event) => setPrizeCsvText(event.target.value)} />
            <button className="button button-small button-secondary" type="button" onClick={() => applyPrizeCsv(prizeCsvText)} disabled={!prizeCsvText.trim()}>匯入貼上的內容</button>
          </div>

          {orderedPrizes.length === 0
            ? <p className="result-empty"><strong>還沒有獎項</strong>用上方表單新增，或匯入 CSV。</p>
            : <ul className="event-lottery-prize-list">
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
                    <span className="pdf-merge-handle" aria-hidden="true">⠿</span>
                    {prize.imageDataUrl
                      ? <img className="event-lottery-prize-thumb" src={prize.imageDataUrl} alt="" />
                      : <span className="event-lottery-prize-thumb event-lottery-prize-thumb-empty" aria-hidden="true">◇</span>}
                    <div className="event-lottery-prize-info">
                      <input className="key-input" type="text" defaultValue={prize.name} maxLength={MAX_NAME_LENGTH} onBlur={(event) => handleUpdatePrize(prize.id, { name: event.target.value.trim().slice(0, MAX_NAME_LENGTH) || prize.name })} aria-label={`獎項名稱：${prize.name}`} />
                      <div className="event-lottery-prize-meta">
                        <label className="number-field">總數量
                          <input className="number-input" type="number" min={prize.drawnCount || 1} value={prize.totalCount} onChange={(event) => handleUpdatePrize(prize.id, { totalCount: Math.max(prize.drawnCount || 1, Math.round(Number(event.target.value)) || prize.totalCount) })} />
                        </label>
                        <span className="panel-meta">已抽 {prize.drawnCount} · 剩餘 {remainingSlots(prize)}</span>
                        <label className="check-row"><input type="checkbox" checked={prize.allowRepeatWinners} onChange={(event) => handleUpdatePrize(prize.id, { allowRepeatWinners: event.target.checked })} />允許已得獎者再次參加</label>
                      </div>
                      <fieldset className="event-lottery-roster-checks">
                        <legend>適用名單（不勾選代表全部）</legend>
                        {state.rosters.map((roster) => (
                          <label className="check-row" key={roster.id}>
                            <input type="checkbox" checked={prize.eligibleRosterIds.includes(roster.id)} onChange={() => toggleEligibleRoster(prize.id, roster.id)} />
                            {roster.name}
                          </label>
                        ))}
                      </fieldset>
                    </div>
                    <div className="event-lottery-prize-actions">
                      <button className="gantt-row-delete" type="button" aria-label="往上移" disabled={index === 0} onClick={() => movePrize(prize.id, -1)}>↑</button>
                      <button className="gantt-row-delete" type="button" aria-label="往下移" disabled={index === orderedPrizes.length - 1} onClick={() => movePrize(prize.id, 1)}>↓</button>
                      <button className="button button-small button-secondary" type="button" onClick={() => prizeImageInputRefs.current.get(prize.id)?.click()}>{prize.imageDataUrl ? "更換圖片" : "上傳圖片"}</button>
                      <input ref={(element) => { prizeImageInputRefs.current.set(prize.id, element); }} className="file-input" type="file" accept="image/png,image/jpeg,image/webp" aria-label={`上傳「${prize.name}」的圖片`} onChange={(event) => { const file = event.target.files?.[0]; if (file) void handlePrizeImage(prize.id, file); event.target.value = ""; }} />
                      <button className="button button-small button-danger" type="button" onClick={() => handleDeletePrize(prize.id)}>{prizeConfirm.armedId === prize.id ? "確定？" : "刪除"}</button>
                    </div>
                  </li>
                ))}
              </ul>}
        </div>
      )}

      {tab === "draw" && (
        <div className="panel panel-tinted" role="tabpanel" aria-label="抽獎控制">
          <div className="panel-header"><h2>抽獎控制</h2></div>
          {orderedPrizes.length === 0
            ? <p className="result-empty"><strong>還沒有獎項</strong>請先到「獎項管理」新增至少一個獎項。</p>
            : <>
                {drawLocked && <p className="gantt-notice gantt-notice-info">上一輪還在舞台上揭曉中，請稍候再開始下一輪（可以按「清除舞台顯示」提前中止）</p>}
                <div className="event-lottery-inline-form">
                  <label className="number-field" htmlFor="draw-prize">選擇獎項
                    <select id="draw-prize" className="key-input" value={effectiveDrawPrizeId} disabled={drawLocked} onChange={(event) => setDrawPrizeId(event.target.value)}>
                      {orderedPrizes.map((prize) => <option key={prize.id} value={prize.id}>{prize.name}（剩餘 {remainingSlots(prize)}）</option>)}
                    </select>
                  </label>
                  <label className="number-field" htmlFor="draw-count">本輪抽出人數
                    <input id="draw-count" className="number-input" type="number" min={1} max={Math.max(1, drawRemaining)} value={state.stageDrawCount} disabled={drawLocked} onChange={(event) => handleStageDrawCountChange(Number(event.target.value))} />
                  </label>
                </div>
                {drawTargetPrize && <p className="panel-meta">符合資格的候選人：{drawCandidates.length} 位 · 獎項剩餘名額：{drawRemaining} 個</p>}
                <div className="event-lottery-quick-actions">
                  <button className="button button-secondary" type="button" onClick={handlePrepareStage} disabled={drawLocked || !drawTargetPrize}>準備舞台畫面</button>
                  <button className="button button-blue draw-button" type="button" onClick={handleStartDraw} disabled={drawLocked || !drawTargetPrize || drawRemaining === 0}>{drawLocked ? "抽選中…" : "開始抽獎"}</button>
                  <button className="button button-secondary" type="button" onClick={handleClearStage}>清除舞台顯示</button>
                  <button className="button button-danger" type="button" onClick={handleResetEvent}>{resetConfirm.armedId === "reset" ? "再按一次確定重置" : "重置抽獎進度"}</button>
                </div>
              </>}
        </div>
      )}

      {tab === "history" && (
        <div className="panel" role="tabpanel" aria-label="得獎紀錄">
          <div className="panel-header"><h2>得獎紀錄</h2><span className="panel-meta">共 {state.winners.length} 筆</span></div>
          <div className="event-lottery-quick-actions">
            <button className="button button-small button-secondary" type="button" onClick={handleExportWinnersCsv} disabled={state.winners.length === 0}>匯出得獎紀錄 CSV</button>
          </div>
          {sortedWinners.length === 0
            ? <p className="result-empty"><strong>還沒有得獎紀錄</strong>到「抽獎控制」開始第一輪抽選。</p>
            : <div className="csv-table-scroll"><table className="csv-table event-lottery-table">
                <thead><tr><th>時間</th><th>獎項</th><th>姓名</th><th>員工編號</th><th>部門</th><th>狀態</th><th></th></tr></thead>
                <tbody>
                  {sortedWinners.map((winner) => (
                    <tr key={winner.id} className={winner.disqualified ? "event-lottery-row-disqualified" : undefined}>
                      <td>{new Date(winner.drawnAt).toLocaleString("zh-TW", { hour12: false })}</td>
                      <td>{prizeNameById.get(winner.prizeId) ?? "（已刪除的獎項）"}</td>
                      <td>{winner.participantName}</td>
                      <td>{winner.employeeId}</td>
                      <td>{winner.department}</td>
                      <td>{winner.disqualified ? "已失格" : "得獎"}</td>
                      <td>{!winner.disqualified && <button className="button button-small button-danger" type="button" onClick={() => handleDisqualify(winner.id)}>{winnerConfirm.armedId === winner.id ? "確定？" : "標記失格"}</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>}
        </div>
      )}
    </section>
  );
}
