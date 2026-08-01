"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

export type RemoteNotice = { text: string; tone: "info" | "error" };

/**
 * 控制台的「手機遙控」配對狀態。這是一個完全選填的加值功能：沒有設定 Supabase
 * 時整段就是關閉狀態，本機抽獎完全不受影響——所以刻意抽成獨立的 hook，跟控制台
 * 的抽獎狀態（LotteryEventState）零耦合，任何一邊壞掉都不會牽連另一邊。
 *
 * 這裡只負責「配對」：建立／撤銷 session、產生 QR Code、觀察手機是否已連上。
 * 實際的遙控指令一律由舞台頁處理（見 stage/event-lottery-stage.tsx），避免控制台
 * 與舞台同時處理同一個手機命令而抽兩次。
 */
export function useRemoteSession() {
  const supabaseConfigured = useMemo(() => isSupabaseConfigured(), []);
  const [session, setSession] = useState<StoredRemoteSessionPointer | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<RemoteNotice | null>(null);
  const [pairedAt, setPairedAt] = useState<number | null>(null);
  const channelRef = useRef<RemoteChannelHandle | null>(null);

  function showNotice(text: string, tone: RemoteNotice["tone"] = "info") {
    setNotice({ text, tone });
  }

  async function subscribeChannel(sessionId: string) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    channelRef.current?.close();
    channelRef.current = null;
    const handle = await connectRemoteChannel(supabase, sessionId, (message) => {
      // 控制台只被動觀察配對狀態（手機連上時會送 REMOTE_HELLO），實際指令一律由
      // 舞台處理，避免控制台與舞台同時處理同一個手機命令。
      if (message.type === "REMOTE_HELLO") {
        setPairedAt(Date.now());
        try { window.sessionStorage.removeItem(EVENT_LOTTERY_REMOTE_PAIRING_TOKEN_KEY); } catch { /* sessionStorage 不可用不影響配對 */ }
        setQrDataUrl("");
      }
    });
    channelRef.current = handle;
  }

  useEffect(() => {
    if (!supabaseConfigured || typeof window === "undefined") return;
    let cancelled = false;
    try {
      const raw = window.localStorage.getItem(EVENT_LOTTERY_REMOTE_STORAGE_KEY);
      const pointer = raw ? sanitizeStoredRemoteSessionPointer(JSON.parse(raw)) : null;
      if (pointer && isRemoteSessionUsable({ expiresAt: pointer.expiresAt, revokedAt: null })) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSession(pointer);
        let pairingToken: string | null = null;
        try { pairingToken = window.sessionStorage.getItem(EVENT_LOTTERY_REMOTE_PAIRING_TOKEN_KEY); } catch { /* sessionStorage 不可用仍要繼續訂閱既有 session */ }
        if (pairingToken && /^[0-9a-f]{64}$/i.test(pairingToken)) {
          void import("qrcode").then(({ default: QRCode }) => QRCode.toDataURL(
            buildPairingUrl(window.location.origin, pointer.sessionId, pairingToken),
            { errorCorrectionLevel: "M", margin: 2, width: 320 },
          )).then((dataUrl) => { if (!cancelled) setQrDataUrl(dataUrl); }).catch(() => undefined);
        }
        void subscribeChannel(pointer.sessionId).then(() => { if (cancelled) channelRef.current?.close(); });
      } else if (raw) {
        window.localStorage.removeItem(EVENT_LOTTERY_REMOTE_STORAGE_KEY);
      }
    } catch {
      /* localStorage 損壞就當作沒有先前的 session */
    }
    return () => {
      cancelled = true;
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, [supabaseConfigured]);

  async function enable() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { showNotice("尚未設定手機遙控服務", "error"); return; }
    setBusy(true);
    setNotice(null);
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
      setSession(pointer);
      setPairedAt(null);

      const pairingUrl = buildPairingUrl(window.location.origin, pointer.sessionId, token);
      const QRCode = (await import("qrcode")).default;
      const dataUrl = await QRCode.toDataURL(pairingUrl, { errorCorrectionLevel: "M", margin: 2, width: 320 });
      setQrDataUrl(dataUrl);
      await subscribeChannel(pointer.sessionId);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "啟用手機遙控失敗，請稍後再試", "error");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    const supabase = getSupabaseBrowserClient();
    if (!session) return;
    setBusy(true);
    try {
      if (!supabase) throw new Error("尚未設定手機遙控服務");
      const { error } = await supabase.rpc("revoke_lottery_remote_session", { session_id: session.sessionId });
      if (error) throw error;
      try {
        await channelRef.current?.send({ type: "SESSION_REVOKED" });
      } catch {
        /* DB 已完成撤銷；即時通知只是加速讓手機離線，失敗不影響權限撤銷。 */
      }
      showNotice("已撤銷手機遙控");
      channelRef.current?.close();
      channelRef.current = null;
      window.localStorage.removeItem(EVENT_LOTTERY_REMOTE_STORAGE_KEY);
      try { window.sessionStorage.removeItem(EVENT_LOTTERY_REMOTE_PAIRING_TOKEN_KEY); } catch { /* ignore */ }
      setSession(null);
      setQrDataUrl("");
      setPairedAt(null);
    } catch (error) {
      // RPC 失敗時保留 session 指標與控制項，讓使用者可以重試；不能讓
      // 資料庫仍有效的 session 失去撤銷入口。
      showNotice(error instanceof Error ? error.message : "撤銷失敗，請稍後再試", "error");
    } finally {
      setBusy(false);
    }
  }

  // 純粹驅動「配對是否還算在線」的畫面更新；沒有配對紀錄時完全不需要跑計時器。
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (pairedAt === null) return;
    const interval = setInterval(() => setNowTick(Date.now()), 5000);
    return () => clearInterval(interval);
  }, [pairedAt]);

  return {
    supabaseConfigured,
    session,
    qrDataUrl,
    busy,
    notice,
    paired: pairedAt !== null,
    pairedStale: pairedAt !== null && nowTick - pairedAt > 30_000,
    enable,
    revoke,
  };
}
