"use client";

import { useMemo, useState } from "react";
import { disqualifyWinner, formatLotteryTimestamp, winnersToCsv, type LotteryEventState } from "@/lib/event-lottery";
import { downloadBlob } from "@/lib/download";
import { type Notice } from "./console-shared";
import type { EventLotterySyncMessage } from "./sync";
import { useArmedConfirm } from "./use-armed-confirm";

type HistoryTabProps = {
  /** 見 prizes-tab.tsx 的說明：元件保持掛載、只是不輸出 DOM，
   *  這樣「顯示/關閉 取消重抽按鈕」的開關狀態切分頁後不會被重置。 */
  active: boolean;
  state: LotteryEventState;
  commit: (next: LotteryEventState, message?: EventLotterySyncMessage) => void;
  showNotice: (text: string, tone?: Notice["tone"]) => void;
};

export function HistoryTab({ active, state, commit, showNotice }: HistoryTabProps) {
  const [showDisqualify, setShowDisqualify] = useState(false);
  const winnerConfirm = useArmedConfirm();

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
    downloadBlob(new Blob([winnersToCsv(state)], { type: "text/csv;charset=utf-8" }), `歷史中獎名單_${Date.now()}.csv`);
  }

  if (!active) return null;

  return (
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
  );
}
