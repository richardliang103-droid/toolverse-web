"use client";

import {
  advanceStateRevision,
  clearStage as clearStageState,
  drawEventWinners,
  previewPrizeWinners,
  prepareStagePrize as prepareStagePrizeState,
  type LotteryEventState,
} from "@/lib/event-lottery";
import { loadEventState, saveEventState, withEventLotteryLock } from "./sync";
import type { EventLotterySyncMessage } from "./sync";

/**
 * 抽獎的實際動作（準備舞台、開始抽獎、清除舞台）獨立出來，讓控制台的按鈕跟
 * 舞台的簡報筆／鍵盤／點擊都呼叫同一套邏輯——兩邊寫進 localStorage 的資料與
 * 廣播的事件完全一致，不會因為操作入口不同就產生兩套微妙不同的行為。
 *
 * 每個動作的「讀最新狀態→計算→寫入」都包在 withEventLotteryLock 裡，確保
 * 跨分頁真正互斥：不會有兩個分頁各自讀到同一份舊資料、都通過驗證後才動手
 * 寫入，讓後寫的一方把先寫的一方（例如舞台剛抽出的得獎者）蓋掉。也不相信
 * 呼叫端傳進來的 React state 快照——控制台的 state 可能因為還沒處理完另一
 * 分頁剛送來的 BroadcastChannel 訊息而落後，一律在鎖裡面重新讀取。
 */
export type DrawActionResult = { ok: true; state: LotteryEventState } | { ok: false; reason: string };

type Post = (message: EventLotterySyncMessage) => void;

export function prepareStage(prizeId: string, post: Post): Promise<DrawActionResult> {
  return withEventLotteryLock((): DrawActionResult => {
    const current = loadEventState();
    const next = advanceStateRevision(prepareStagePrizeState(current, prizeId));
    if (!saveEventState(next)) return { ok: false, reason: "儲存失敗，可能是瀏覽器儲存空間不足，請刪減圖片或紀錄後再試" };
    post({ type: "PREPARE_PRIZE", prizeId });
    return { ok: true, state: next };
  });
}

/**
 * 抽選只有「一次」原子寫入：得獎紀錄、獎項已抽數量與這一輪的揭曉時間表
 * （pendingReveal）一起落地。舞台什麼時候看起來揭曉，交給 resolveStageDisplay
 * 用目前時間現算，不依賴這裡的計時器活著——就算儲存成功後立刻重新整理或整個
 * 關掉觸發這次抽選的分頁，其他分頁都能算出正確畫面。這裡排的 setTimeout 純粹
 * 是「揭曉那一刻順便廣播一次 DRAW_RESULT」的錦上添花，沒收到也不影響正確性，
 * 也不需要留在鎖裡面（鎖只保護實際的讀改寫，不是這個事後通知）。
 */
export function startDraw(prizeId: string, count: number, post: Post): Promise<DrawActionResult> {
  return withEventLotteryLock((): DrawActionResult => {
    const current = loadEventState();
    let outcome;
    try {
      outcome = drawEventWinners(current, prizeId, count);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "抽選時發生錯誤";
      post({ type: "DRAW_ERROR", message: reason });
      return { ok: false, reason };
    }
    const nextState = advanceStateRevision(outcome.nextState);
    if (!saveEventState(nextState)) {
      const reason = "儲存失敗，可能是瀏覽器儲存空間不足，這輪抽獎未送出，請刪減圖片或紀錄後再試";
      post({ type: "DRAW_ERROR", message: reason });
      return { ok: false, reason };
    }
    post({ type: "START_DRAW", prizeId });
    return { ok: true, state: nextState };
  }).then((result) => {
    if (result.ok && result.state.pendingReveal) {
      const revealAt = result.state.pendingReveal.revealAt;
      const delay = Math.max(0, Date.parse(revealAt) - Date.now());
      window.setTimeout(() => post({ type: "DRAW_RESULT", prizeId }), delay);
    }
    return result;
  });
}

export function clearStageAction(post: Post): Promise<DrawActionResult> {
  return withEventLotteryLock((): DrawActionResult => {
    const current = loadEventState();
    const next = advanceStateRevision(clearStageState(current));
    if (!saveEventState(next)) return { ok: false, reason: "儲存失敗，可能是瀏覽器儲存空間不足，請刪減圖片或紀錄後再試" };
    post({ type: "CLEAR_STAGE" });
    return { ok: true, state: next };
  });
}

export function previewPrizeWinnersAction(prizeId: string, post: Post): Promise<DrawActionResult> {
  return withEventLotteryLock((): DrawActionResult => {
    try {
      const current = loadEventState();
      const next = advanceStateRevision(previewPrizeWinners(current, prizeId));
      if (!saveEventState(next)) return { ok: false, reason: "儲存失敗，可能是瀏覽器儲存空間不足，請刪減圖片或紀錄後再試" };
      post({ type: "PREPARE_PRIZE", prizeId });
      return { ok: true, state: next };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "無法顯示歷史得獎名單" };
    }
  });
}
