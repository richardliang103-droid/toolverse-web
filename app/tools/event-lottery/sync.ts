"use client";

import { useEffect, useRef } from "react";
import {
  createEmptyEventState,
  EVENT_LOTTERY_CHANNEL_NAME,
  EVENT_LOTTERY_STORAGE_KEY,
  sanitizeEventState,
  type LotteryEventState,
} from "@/lib/event-lottery";

/**
 * 控制台與舞台的分頁同步事件。抽出結果一律先在控制台用安全亂數確定並完整寫進
 * localStorage（含這一輪的揭曉時間表），這裡的訊息只是「請重新讀取狀態」的
 * 即時提示，不是唯一的真相來源——就算訊息遺失或分頁重新整理，接收端都能單靠
 * localStorage 目前的內容＋目前時間，算出正確畫面（見 lib/event-lottery.ts 的
 * resolveStageDisplay）。
 */
export type EventLotterySyncMessage =
  | { type: "STATE_UPDATED" }
  | { type: "PREPARE_PRIZE"; prizeId: string }
  | { type: "START_DRAW"; prizeId: string }
  | { type: "DRAW_RESULT"; prizeId: string }
  /** 舞台把這一輪（drawId）全部揭曉完畢後回報；控制台收到才確定解鎖下一輪，
   *  不是單純猜測動畫應該播完了。 */
  | { type: "DRAW_FINISHED"; drawId: string }
  | { type: "DRAW_ERROR"; message: string }
  | { type: "CLEAR_STAGE" }
  | { type: "DISQUALIFY_WINNER"; winnerId: string }
  | { type: "RESET_EVENT" };

/** localStorage 可能被寫壞；讀取失敗一律退回空活動狀態，不讓頁面崩潰。 */
export function loadEventState(): LotteryEventState {
  if (typeof window === "undefined") return createEmptyEventState();
  try {
    const raw = window.localStorage.getItem(EVENT_LOTTERY_STORAGE_KEY);
    return raw ? sanitizeEventState(JSON.parse(raw)) : createEmptyEventState();
  } catch {
    return createEmptyEventState();
  }
}

/** 寫入失敗（例如 localStorage 容量不足）回傳 false，呼叫端負責顯示訊息，不拋例外。 */
export function saveEventState(state: LotteryEventState): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(EVENT_LOTTERY_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/**
 * 分頁同步：優先用 BroadcastChannel 即時廣播事件，並疊加 `storage` 事件
 * 當備援（BroadcastChannel 不支援或訊息遺失時，只要 localStorage 有變動，
 * 其他分頁至少會收到一次 STATE_UPDATED 而重新讀取）。只需同源、同瀏覽器的
 * 不同分頁或視窗之間同步。
 */
export function useEventLotterySync(onMessage: (message: EventLotterySyncMessage) => void) {
  const handlerRef = useRef(onMessage);
  useEffect(() => { handlerRef.current = onMessage; });
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(EVENT_LOTTERY_CHANNEL_NAME) : null;
    channelRef.current = channel;
    if (channel) {
      channel.onmessage = (event) => {
        const data = event.data as EventLotterySyncMessage;
        if (data && typeof data.type === "string") handlerRef.current(data);
      };
    }

    function onStorage(event: StorageEvent) {
      if (event.key === EVENT_LOTTERY_STORAGE_KEY) handlerRef.current({ type: "STATE_UPDATED" });
    }
    window.addEventListener("storage", onStorage);

    return () => {
      channel?.close();
      channelRef.current = null;
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  function post(message: EventLotterySyncMessage) {
    channelRef.current?.postMessage(message);
  }

  return post;
}
