"use client";

import { useMemo, useRef, useState } from "react";
import {
  canDeletePrize,
  createEmptyEventState,
  createPrize,
  MAX_NAME_LENGTH,
  MAX_PRIZES,
  parsePrizesCsv,
  remainingSlots,
  type EventPrize,
  type LotteryEventState,
} from "@/lib/event-lottery";
import { encodingLabel, type DetectedTextEncoding, type TextEncodingPreference } from "@/lib/text-encoding";
import { downloadCsvTemplate, PRIZE_CSV_TEMPLATE, readCsvText, resizeImageToDataUrl, type Notice } from "./console-shared";
import { useArmedConfirm } from "./use-armed-confirm";

type PrizesTabProps = {
  /** 非目前分頁時回傳 null，但元件本身仍然掛載——這樣新增獎項表單打到一半的
   *  草稿在切走再切回來時還在，跟拆檔之前（狀態放在控制台元件裡）行為一致。 */
  active: boolean;
  state: LotteryEventState;
  commit: (next: LotteryEventState) => void;
  showNotice: (text: string, tone?: Notice["tone"]) => void;
  /** 逐項編輯的 modal 由控制台統一渲染（跟其他 modal 放在一起，維持既有的 DOM 順序）。 */
  onEditPrize: (prize: EventPrize) => void;
  /** 更新單一獎項；跟編輯 modal 的儲存共用同一個實作，避免兩邊邏輯分岔。 */
  onUpdatePrize: (id: string, patch: Partial<EventPrize>) => void;
  /** 切換「在舞台顯示這個獎項的歷史得獎名單」；會動到 stagePreview，屬於舞台狀態。 */
  onShowPrizeWinners: (prizeId: string) => void;
};

export function PrizesTab({ active, state, commit, showNotice, onEditPrize, onUpdatePrize, onShowPrizeWinners }: PrizesTabProps) {
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
  const prizeConfirm = useArmedConfirm();

  const firstRosterId = state.rosters[0]?.id ?? "";
  const orderedPrizes = useMemo(() => [...state.prizes].sort((a, b) => a.order - b.order), [state.prizes]);
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
      onUpdatePrize(id, { imageDataUrl: dataUrl });
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "圖片處理失敗", "error");
    }
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

  if (!active) return null;

  return (
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
                  <input key={`${prize.id}:${prize.name}`} className="key-input" type="text" defaultValue={prize.name} maxLength={MAX_NAME_LENGTH} onBlur={(event) => onUpdatePrize(prize.id, { name: event.target.value.trim().slice(0, MAX_NAME_LENGTH) || prize.name })} aria-label={`獎項名稱：${prize.name}`} />
                </div>
                <div className="event-lottery-prize-qty">
                  <span className="event-lottery-prize-count"><strong>{prize.drawnCount}</strong><span aria-hidden="true">/</span>{prize.totalCount}</span>
                  <label className="number-field event-lottery-prize-edit-count">總數量
                    <input className="number-input" type="number" min={prize.drawnCount || 1} value={prize.totalCount} onChange={(event) => onUpdatePrize(prize.id, { totalCount: Math.max(prize.drawnCount || 1, Math.round(Number(event.target.value)) || prize.totalCount) })} />
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
                    onClick={() => onShowPrizeWinners(prize.id)}
                    disabled={state.stagePreview?.prizeId !== prize.id && !state.winners.some((winner) => winner.prizeId === prize.id)}
                  >
                    {state.stagePreview?.prizeId === prize.id ? "🛑" : "👁️"}
                  </button>
                  <button className="button button-small button-secondary" type="button" onClick={() => onEditPrize(prize)}>編輯</button>
                  <button className="button button-small button-secondary" type="button" onClick={() => prizeImageInputRefs.current.get(prize.id)?.click()}>{prize.imageDataUrl ? "更換圖片" : "上傳圖片"}</button>
                  <input ref={(element) => { prizeImageInputRefs.current.set(prize.id, element); }} className="file-input" type="file" accept="image/*" aria-label={`上傳「${prize.name}」的圖片`} onChange={(event) => { const file = event.target.files?.[0]; if (file) void handlePrizeImage(prize.id, file); event.target.value = ""; }} />
                  <button className="button button-small button-danger" type="button" onClick={() => handleDeletePrize(prize.id)}>{prizeConfirm.armedId === prize.id ? "確定？" : "刪除"}</button>
                </div>
              </li>
            ))}
            </ul>
          </>}
      </section>
  );
}
