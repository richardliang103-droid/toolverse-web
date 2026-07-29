import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { remoteChannelTopic } from "./event-lottery-remote.ts";
import type { RemoteMessage } from "./event-lottery-remote-types.ts";

/**
 * 這個模組是唯一會直接碰 Supabase Auth／Realtime 的地方（電腦控制台、舞台、
 * 手機遙控頁共用），刻意跟 lib/event-lottery-remote.ts 的純函式分開——那邊的
 * 邏輯要能在 node --test 下單獨測試，不該依賴瀏覽器或網路。
 *
 * 只有下列兩種情境才可以呼叫 ensureAnonymousSession()：
 *   1. 電腦使用者明確按下「啟用手機遙控」
 *   2. 手機開啟包含有效 session id 與 pairing token 的配對網址
 * 一般瀏覽活動抽獎控制台或舞台都不應該呼叫這裡的任何函式。
 */

export async function ensureAnonymousSession(supabase: SupabaseClient) {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;
  const { data: signedIn, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return signedIn.session;
}

/** private channel 需要先把目前 Auth session 的 access token 交給 Realtime，
 *  之後才能通過 realtime.messages 的 RLS 檢查。 */
async function ensureRealtimeAuth(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return false;
  await supabase.realtime.setAuth(data.session.access_token);
  return true;
}

export type RemoteChannelHandle = {
  send: (message: RemoteMessage) => Promise<void>;
  close: () => void;
};

export type RemoteChannelStatus = "connecting" | "connected" | "disconnected";

/** 訂閱 `lottery:<session-id>` private broadcast channel；沒有有效 Auth session
 *  或訂閱失敗都回傳 null，呼叫端要把這種情況當成「暫時連不上，稍後可重試」。 */
export async function connectRemoteChannel(
  supabase: SupabaseClient,
  sessionId: string,
  onMessage: (message: RemoteMessage) => void,
  onStatusChange?: (status: RemoteChannelStatus) => void,
): Promise<RemoteChannelHandle | null> {
  const authed = await ensureRealtimeAuth(supabase);
  if (!authed) return null;

  const channel: RealtimeChannel = supabase.channel(remoteChannelTopic(sessionId), { config: { private: true } });
  channel.on("broadcast", { event: "message" }, (payload) => {
    const data = payload.payload as RemoteMessage;
    if (data && typeof data.type === "string") onMessage(data);
  });

  const subscribed = await new Promise<boolean>((resolve) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") { onStatusChange?.("connected"); resolve(true); }
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") { onStatusChange?.("disconnected"); resolve(false); }
    });
  });
  if (!subscribed) {
    void supabase.removeChannel(channel);
    return null;
  }

  return {
    send: async (message) => { await channel.send({ type: "broadcast", event: "message", payload: message }); },
    close: () => { void supabase.removeChannel(channel); },
  };
}
