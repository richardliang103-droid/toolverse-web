"use client";

import { useRef } from "react";
import { MAX_TITLE_LENGTH, totalParticipantCount, type LotteryEventState } from "@/lib/event-lottery";
import { resizeImageToDataUrl, type Notice } from "./console-shared";
import { useArmedConfirm } from "./use-armed-confirm";
import type { useRemoteSession } from "./use-remote-session";

type SettingsTabProps = {
  /** 見 prizes-tab.tsx 的說明：元件保持掛載，只是不輸出 DOM。 */
  active: boolean;
  state: LotteryEventState;
  commit: (next: LotteryEventState) => void;
  showNotice: (text: string, tone?: Notice["tone"]) => void;
  /** 大標題的草稿留在控制台：它有一個 effect 會在活動狀態變更（跨分頁同步、
   *  匯入備份）時把輸入框同步回最新標題，那個 effect 屬於控制台的生命週期。 */
  eventTitleDraft: string;
  onEventTitleDraftChange: (value: string) => void;
  onUpdateEventTitle: () => void;
  availableCount: number;
  /** useRemoteSession() 的回傳值；手機遙控面板只是把它呈現出來。 */
  remote: ReturnType<typeof useRemoteSession>;
};

export function SettingsTab({
  active, state, commit, showNotice,
  eventTitleDraft, onEventTitleDraftChange, onUpdateEventTitle, availableCount, remote,
}: SettingsTabProps) {
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const backgroundConfirm = useArmedConfirm();

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

  if (!active) return null;

  return (
      <>
      <div className="panel event-lottery-settings-panel">
        <div className="panel-header"><h2>活動設定</h2><span className="panel-meta">共 {totalParticipantCount(state.participants)} 人 · 可抽 {availableCount} 人</span></div>
        <label className="event-lottery-field" htmlFor="event-title">前台大標題
          <div className="event-lottery-title-editor">
            <input id="event-title" className="key-input" type="text" value={eventTitleDraft} maxLength={MAX_TITLE_LENGTH} onChange={(event) => onEventTitleDraftChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onUpdateEventTitle(); }} />
            <button className="button button-small button-blue" type="button" onClick={onUpdateEventTitle}>更新</button>
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
            <span className="event-lottery-field-suffix">秒</span>
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

      {!remote.supabaseConfigured ? (
        <div className="panel event-lottery-remote-panel event-lottery-remote-panel-collapsed" aria-label="手機遙控">
          <span className="panel-meta">📱 手機遙控（選填功能，不影響本機抽獎）：尚未設定手機遙控服務</span>
        </div>
      ) : (
      <div className="panel event-lottery-remote-panel" aria-label="手機遙控">
        <div className="panel-header"><h2>手機遙控</h2><span className="panel-meta">選填功能，不影響本機抽獎</span></div>
        {!remote.session && (
          <div className="event-lottery-quick-actions">
            <button className="button button-blue" type="button" onClick={remote.enable} disabled={remote.busy}>{remote.busy ? "啟用中…" : "啟用手機遙控"}</button>
          </div>
        )}
        {remote.session && (
          <div className="event-lottery-remote-qr">
            {remote.qrDataUrl && !remote.paired && <img src={remote.qrDataUrl} alt="手機遙控配對 QR Code，用手機相機掃描後直接進入遙控頁" />}
            <div className="event-lottery-remote-qr-meta">
              {!remote.paired && <p>{remote.qrDataUrl ? "等待手機掃描…" : "已建立 session；控制台重新整理過就無法再顯示 QR Code，請撤銷後重新啟用"}</p>}
              {remote.paired && <p><strong>{remote.pairedStale ? "手機可能已離線" : "已配對"}</strong></p>}
              <p>Session 到期時間：{new Date(remote.session.expiresAt).toLocaleString("zh-TW", { hour12: false })}</p>
              <div className="event-lottery-quick-actions">
                <button className="button button-small button-danger" type="button" onClick={remote.revoke} disabled={remote.busy}>撤銷手機遙控</button>
              </div>
            </div>
          </div>
        )}
        {remote.notice && <p className={`gantt-notice gantt-notice-${remote.notice.tone}`} role={remote.notice.tone === "error" ? "alert" : "status"}>{remote.notice.text}</p>}
      </div>
      )}
      </>
  );
}
