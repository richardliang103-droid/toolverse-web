"use client";

import { useMemo, useState } from "react";
import {
  candidatePool,
  findNextDrawablePrize,
  MAX_DRAW_COUNT_PER_ROUND,
  remainingSlots,
  type EventPrize,
  type LotteryEventState,
} from "@/lib/event-lottery";
import { type Notice } from "./console-shared";

type DrawTabProps = {
  /** 見 prizes-tab.tsx 的說明：元件保持掛載，切分頁回來時選好的獎項不會被清掉。 */
  active: boolean;
  state: LotteryEventState;
  commit: (next: LotteryEventState) => void;
  showNotice: (text: string, tone?: Notice["tone"]) => void;
  /** 舞台正在播放中（揭曉動畫／重抽提示／歷史名單），這一輪不能再開始下一輪。 */
  drawLocked: boolean;
  noticeLocked: boolean;
  previewLocked: boolean;
  /** 準備／抽獎／清除舞台都要透過控制台的 post 與 setState 才能同步到其他分頁，
   *  所以實作留在控制台，這裡只負責把使用者選好的獎項交出去。 */
  onPrepareStage: (prize: EventPrize) => void;
  onStartDraw: (prize: EventPrize) => void;
  onClearStage: () => void;
  onResetEvent: () => void;
  /** 「重置抽獎進度」的兩段式確認是否已武裝（confirm 本身在控制台，跟其他破壞性操作放一起）。 */
  resetArmed: boolean;
};

export function DrawTab({
  active, state, commit, showNotice, drawLocked, noticeLocked, previewLocked,
  onPrepareStage, onStartDraw, onClearStage, onResetEvent, resetArmed,
}: DrawTabProps) {
  const [drawPrizeId, setDrawPrizeId] = useState("");

  const orderedPrizes = useMemo(() => [...state.prizes].sort((a, b) => a.order - b.order), [state.prizes]);

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
    onPrepareStage(drawTargetPrize);
  }

  function handleStartDraw() {
    if (drawLocked) return;
    if (!drawTargetPrize) { showNotice("請先選擇獎項", "error"); return; }
    onStartDraw(drawTargetPrize);
  }

  if (!active) return null;

  return (
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
              <button className="button button-secondary" type="button" onClick={onClearStage}>清除舞台顯示</button>
              <button className="button button-danger" type="button" onClick={onResetEvent}>{resetArmed ? "再按一次確定重置" : "重置抽獎進度"}</button>
            </div>
          </>}
      </section>
  );
}
