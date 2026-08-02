"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { SendToTools } from "@/components/send-to-tools";
import { TEXT_TOOL_SLUGS } from "@/lib/handoff";
import {
  MAX_EXPENSES,
  MAX_PARTICIPANTS,
  calculateExpenseSplit,
  formatTwd,
  sanitizeExpenseSplitDraft,
  settlementText,
  toTwdAmount,
  type SplitExpense,
  type SplitParticipant,
} from "@/lib/expense-splitter";

const STORAGE_KEY = "toolverse:expense-splitter:v1";

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function newExpense(participants: readonly SplitParticipant[]): SplitExpense {
  return {
    id: makeId("expense"),
    description: "",
    amount: 0,
    paidBy: participants[0]?.id ?? "",
    sharedBy: participants.map((participant) => participant.id),
  };
}

export function ExpenseSplitterTool() {
  const [participants, setParticipants] = useState<SplitParticipant[]>([]);
  const [expenses, setExpenses] = useState<SplitExpense[]>([]);
  const [participantName, setParticipantName] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const draft = sanitizeExpenseSplitDraft(JSON.parse(stored));
        // localStorage 草稿只能在 client hydration 後讀回；寫入 effect 已以 hydrated 避免覆蓋既有草稿。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setParticipants(draft.participants);
        setExpenses(draft.expenses);
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ participants, expenses }));
  }, [hydrated, participants, expenses]);

  const result = useMemo(() => calculateExpenseSplit(participants, expenses), [participants, expenses]);
  const settlementSummary = useMemo(() => settlementText(result), [result]);

  function addParticipant() {
    const name = participantName.trim().slice(0, 40);
    if (!name) return;
    if (participants.length >= MAX_PARTICIPANTS) { setError(`最多 ${MAX_PARTICIPANTS} 人`); return; }
    if (participants.some((participant) => participant.name.toLocaleLowerCase("zh-TW") === name.toLocaleLowerCase("zh-TW"))) {
      setError("已有同名參加者，請換一個辨識名稱");
      return;
    }
    const participant = { id: makeId("person"), name };
    setParticipants((current) => [...current, participant]);
    setExpenses((current) => current.map((expense) => ({ ...expense, sharedBy: [...expense.sharedBy, participant.id] })));
    setParticipantName("");
    setError("");
  }

  function onParticipantKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") { event.preventDefault(); addParticipant(); }
  }

  function removeParticipant(id: string) {
    setParticipants((current) => current.filter((participant) => participant.id !== id));
    setExpenses((current) => current
      .filter((expense) => expense.paidBy !== id)
      .map((expense) => ({ ...expense, sharedBy: expense.sharedBy.filter((participantId) => participantId !== id) })));
    setCopied(false);
    setError("");
  }

  function addExpense() {
    if (participants.length === 0) { setError("先加入至少一位參加者"); return; }
    if (expenses.length >= MAX_EXPENSES) { setError(`最多 ${MAX_EXPENSES} 筆支出`); return; }
    setExpenses((current) => [...current, newExpense(participants)]);
    setError("");
  }

  function updateExpense(id: string, change: Partial<SplitExpense>) {
    setExpenses((current) => current.map((expense) => expense.id === id ? { ...expense, ...change } : expense));
    setCopied(false);
  }

  function toggleShare(expense: SplitExpense, participantId: string) {
    const sharedBy = expense.sharedBy.includes(participantId)
      ? expense.sharedBy.filter((id) => id !== participantId)
      : [...expense.sharedBy, participantId];
    updateExpense(expense.id, { sharedBy });
  }

  async function copySettlement() {
    try {
      await navigator.clipboard.writeText(settlementSummary);
      setCopied(true);
      setError("");
    } catch {
      setError("無法複製到剪貼簿，請手動選取結果複製");
    }
  }

  function clearAll() {
    if (!clearArmed) { setClearArmed(true); return; }
    setParticipants([]);
    setExpenses([]);
    setParticipantName("");
    setCopied(false);
    setClearArmed(false);
    setError("");
  }

  return <section className="workspace split-workspace page-shell" aria-label="分帳結算工具">
    <div className="panel">
      <div className="panel-header"><h2>同行的人</h2><span className="panel-meta">{participants.length} 人</span></div>
      <div className="split-add-person">
        <label className="sr-only" htmlFor="split-person-name">參加者名稱</label>
        <input id="split-person-name" className="key-input" value={participantName} onChange={(event) => setParticipantName(event.target.value)} onKeyDown={onParticipantKeyDown} placeholder="輸入名字，例如：小安" maxLength={40} />
        <button className="button button-small button-blue" type="button" onClick={addParticipant}>加入</button>
      </div>
      {participants.length === 0
        ? <p className="key-note">先加入一起分帳的人。名字只留在你的瀏覽器裡。</p>
        : <ul className="split-people-list">
            {participants.map((participant) => <li key={participant.id}><span>{participant.name}</span><button type="button" className="gantt-row-delete" aria-label={`移除 ${participant.name}`} onClick={() => removeParticipant(participant.id)}>×</button></li>)}
          </ul>}

      <div className="panel-header split-expense-header"><h2>支出</h2><span className="panel-meta">已填 {expenses.filter((expense) => expense.amount > 0 && expense.sharedBy.length > 0).length} 筆</span></div>
      {expenses.length === 0
        ? <div className="split-empty-expense"><strong>還沒有支出</strong><span>例如：住宿、晚餐、車資。每筆都能選誰先付、誰要分。</span></div>
        : <div className="split-expense-list">
            {expenses.map((expense, index) => <article className="split-expense-card" key={expense.id}>
              <div className="split-expense-heading"><h3>第 {index + 1} 筆</h3><button type="button" className="gantt-row-delete" aria-label={`刪除第 ${index + 1} 筆支出`} onClick={() => setExpenses((current) => current.filter((item) => item.id !== expense.id))}>刪除</button></div>
              <div className="split-expense-fields">
                <label className="field-label" htmlFor={`split-desc-${expense.id}`}>項目
                  <input id={`split-desc-${expense.id}`} className="key-input" value={expense.description} onChange={(event) => updateExpense(expense.id, { description: event.target.value.slice(0, 80) })} placeholder="例如：第一晚住宿" maxLength={80} />
                </label>
                <label className="field-label" htmlFor={`split-amount-${expense.id}`}>金額（元）
                  <input id={`split-amount-${expense.id}`} className="key-input" type="number" inputMode="numeric" min="0" max="100000000" step="1" value={expense.amount === 0 ? "" : expense.amount} onChange={(event) => updateExpense(expense.id, { amount: toTwdAmount(event.target.value) })} placeholder="0" />
                </label>
                <label className="field-label" htmlFor={`split-paid-${expense.id}`}>誰先付
                  <select id={`split-paid-${expense.id}`} className="key-input" value={expense.paidBy} onChange={(event) => updateExpense(expense.id, { paidBy: event.target.value })}>
                    {participants.map((participant) => <option key={participant.id} value={participant.id}>{participant.name}</option>)}
                  </select>
                </label>
              </div>
              <fieldset className="split-shares"><legend>這筆誰要分？</legend><div>
                {participants.map((participant) => <label className="check-row" key={participant.id}><input type="checkbox" checked={expense.sharedBy.includes(participant.id)} onChange={() => toggleShare(expense, participant.id)} />{participant.name}</label>)}
              </div></fieldset>
              {expense.sharedBy.length === 0 && <p className="split-inline-warning">請至少選一位分帳人，這筆才會計入結算。</p>}
            </article>)}
          </div>}
      <div className="result-actions split-actions">
        <button className="button button-small button-blue" type="button" disabled={participants.length === 0} onClick={addExpense}>＋ 新增支出</button>
        {(participants.length > 0 || expenses.length > 0) && <button className="button button-small button-secondary" type="button" onClick={clearAll}>{clearArmed ? "再按一次確認清空" : "清空重來"}</button>}
      </div>
      {clearArmed && <p className="split-inline-warning" role="alert">再按一次會刪除這台裝置上的所有分帳草稿。</p>}
      {error !== "" && <p className="error-message" role="alert">{error}</p>}
      <p className="key-note">金額以整數新台幣計算。先將每個人的淨額抵銷，再整理成精簡的轉帳建議。</p>
    </div>

    <div className="panel panel-tinted">
      <div className="panel-header"><h2>結算結果</h2><span className="panel-meta">合計 {formatTwd(result.totalAmount)}</span></div>
      {result.includedExpenseCount === 0
        ? <div className="result-stage"><div className="result-empty"><strong>等你填入第一筆支出</strong>記下誰先付款、哪些人要分，右邊會即時整理轉帳方向。</div></div>
        : <>
            <section className="split-result-section" aria-labelledby="split-settlement-title">
              <h3 id="split-settlement-title">轉帳建議</h3>
              {result.settlements.length === 0
                ? <p className="split-balanced">帳目已平衡，不需要轉帳。</p>
                : <ol className="split-settlement-list">{result.settlements.map((settlement) => <li key={`${settlement.from.id}-${settlement.to.id}-${settlement.amount}`}><strong>{settlement.from.name}</strong><span>轉給</span><strong>{settlement.to.name}</strong><b>{formatTwd(settlement.amount)}</b></li>)}</ol>}
            </section>
            <section className="split-result-section" aria-labelledby="split-balance-title">
              <h3 id="split-balance-title">各自淨額</h3>
              <ul className="split-balance-list">{result.balances.map((balance) => <li key={balance.id}><span>{balance.name}</span><b className={balance.amount > 0 ? "split-positive" : balance.amount < 0 ? "split-negative" : ""}>{balance.amount > 0 ? "+" : balance.amount < 0 ? "−" : ""}{formatTwd(Math.abs(balance.amount))}{balance.amount > 0 ? " 應收" : balance.amount < 0 ? " 應付" : " 已平"}</b></li>)}</ul>
            </section>
            <div className="result-actions split-result-actions">
              <button className="button button-small button-secondary" type="button" onClick={() => { void copySettlement(); }}>{copied ? "已複製 ✓" : "複製結算文字"}</button>
              <SendToTools from="expense-splitter" targets={TEXT_TOOL_SLUGS} getText={() => settlementSummary} />
            </div>
          </>}
    </div>
  </section>;
}
