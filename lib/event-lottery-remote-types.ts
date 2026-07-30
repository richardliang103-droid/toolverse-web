/**
 * 手機遙控協定：舞台（Remote Command Host）與手機（Remote Client）之間透過
 * Supabase Realtime private broadcast channel 交換的訊息。這裡刻意不包含任何
 * 參加者名單、員工編號、部門、完整得獎紀錄或圖片——手機只需要知道「現在該
 * 顯示什麼、按鈕能不能按」，實際抽選永遠由舞台呼叫既有的
 * lib/event-lottery.ts 邏輯執行。
 */

/** 對應 lib/event-lottery.ts 的 resolveStageDisplay 階段，額外拆出 sequential
 *  逐一揭曉「還在播放中」（revealing）與「整輪播完」（finished）兩種細節，
 *  讓手機知道按鈕何時可以再次按下。 */
export type RemoteHostPhase = "offline" | "idle" | "prepared" | "drawing" | "revealing" | "finished";

export type RemoteNextAction = "prepare" | "draw" | "clear" | "none";

export type RemoteMessage =
  | {
      type: "REMOTE_HELLO";
      clientId: string;
    }
  | {
      type: "HOST_STATUS";
      revision: number;
      phase: RemoteHostPhase;
      nextAction: RemoteNextAction;
      eventTitle: string;
      prizeName: string | null;
      drawCount: number;
      locked: boolean;
      sentAt: string;
    }
  | {
      type: "ADVANCE_COMMAND";
      commandId: string;
      expectedRevision: number;
      sentAt: string;
    }
  | {
      type: "COMMAND_ACK";
      commandId: string;
      accepted: boolean;
      revision: number;
      reason?: string;
    }
  | {
      type: "SESSION_REVOKED";
    };

/** 配對 session 在前端需要知道的最小狀態；不含 pairing token 明文或雜湊。 */
export type LotteryRemoteSession = {
  id: string;
  topic: string;
  expiresAt: string;
  revokedAt: string | null;
  /** remote_user_id 是否已設定（手機是否已配對成功），不回傳實際的使用者 id。 */
  claimed: boolean;
};
