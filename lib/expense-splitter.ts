/**
 * 分帳工具的資料清理與結算邏輯。所有金額都是整數新台幣，避免浮點數造成對帳差額。
 */

export const MAX_PARTICIPANTS = 20;
export const MAX_EXPENSES = 80;
export const MAX_AMOUNT = 100_000_000;

export interface SplitParticipant {
  id: string;
  name: string;
}

export interface SplitExpense {
  id: string;
  description: string;
  amount: number;
  paidBy: string;
  sharedBy: string[];
}

export interface ExpenseSplitDraft {
  participants: SplitParticipant[];
  expenses: SplitExpense[];
}

export interface SplitBalance extends SplitParticipant {
  /** 正數代表應收、負數代表應付。 */
  amount: number;
}

export interface Settlement {
  from: SplitParticipant;
  to: SplitParticipant;
  amount: number;
}

export interface SplitResult {
  totalAmount: number;
  includedExpenseCount: number;
  balances: SplitBalance[];
  settlements: Settlement[];
}

function text(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safeId(value: unknown): string {
  return text(value, 120);
}

export function toTwdAmount(value: unknown): number {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.min(Math.max(Math.round(amount), 0), MAX_AMOUNT);
}

export function sanitizeParticipants(value: unknown): SplitParticipant[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const names = new Set<string>();
  const participants: SplitParticipant[] = [];
  for (const item of value) {
    if (participants.length >= MAX_PARTICIPANTS || typeof item !== "object" || item === null) continue;
    const data = item as Record<string, unknown>;
    const id = safeId(data.id);
    const name = text(data.name, 40);
    const nameKey = name.toLocaleLowerCase("zh-TW");
    if (!id || !name || ids.has(id) || names.has(nameKey)) continue;
    ids.add(id);
    names.add(nameKey);
    participants.push({ id, name });
  }
  return participants;
}

export function sanitizeExpenses(value: unknown, participants: readonly SplitParticipant[]): SplitExpense[] {
  if (!Array.isArray(value)) return [];
  const participantIds = new Set(participants.map((participant) => participant.id));
  const ids = new Set<string>();
  const expenses: SplitExpense[] = [];
  for (const item of value) {
    if (expenses.length >= MAX_EXPENSES || typeof item !== "object" || item === null) continue;
    const data = item as Record<string, unknown>;
    const id = safeId(data.id);
    const paidBy = safeId(data.paidBy);
    if (!id || ids.has(id) || !participantIds.has(paidBy)) continue;
    ids.add(id);
    const sharedBy = Array.isArray(data.sharedBy)
      ? [...new Set(data.sharedBy.map(safeId).filter((participantId) => participantIds.has(participantId)))]
      : [];
    expenses.push({
      id,
      description: text(data.description, 80),
      amount: toTwdAmount(data.amount),
      paidBy,
      sharedBy,
    });
  }
  return expenses;
}

export function sanitizeExpenseSplitDraft(value: unknown): ExpenseSplitDraft {
  const data = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const participants = sanitizeParticipants(data.participants);
  return { participants, expenses: sanitizeExpenses(data.expenses, participants) };
}

function validShares(expense: SplitExpense, participantIds: ReadonlySet<string>): string[] {
  return [...new Set(expense.sharedBy.filter((participantId) => participantIds.has(participantId)))];
}

/**
 * 先把每筆支出化成每個人的淨額，再由最大應付／應收者依序結清。
 * 結果保證守恆、沒有自己轉給自己，且每一步都會讓至少一人的餘額歸零。
 */
export function calculateExpenseSplit(
  participants: readonly SplitParticipant[],
  expenses: readonly SplitExpense[],
): SplitResult {
  const cleanParticipants = sanitizeParticipants(participants);
  const participantIds = new Set(cleanParticipants.map((participant) => participant.id));
  const amounts = new Map(cleanParticipants.map((participant) => [participant.id, 0]));
  let totalAmount = 0;
  let includedExpenseCount = 0;

  for (const expense of sanitizeExpenses(expenses, cleanParticipants)) {
    const shares = validShares(expense, participantIds);
    if (expense.amount <= 0 || shares.length === 0 || !participantIds.has(expense.paidBy)) continue;
    totalAmount += expense.amount;
    includedExpenseCount += 1;
    amounts.set(expense.paidBy, (amounts.get(expense.paidBy) ?? 0) + expense.amount);
    const baseShare = Math.floor(expense.amount / shares.length);
    const remainder = expense.amount % shares.length;
    shares.forEach((participantId, index) => {
      const share = baseShare + (index < remainder ? 1 : 0);
      amounts.set(participantId, (amounts.get(participantId) ?? 0) - share);
    });
  }

  const balances = cleanParticipants.map((participant) => ({ ...participant, amount: amounts.get(participant.id) ?? 0 }));
  const participantsById = new Map(cleanParticipants.map((participant) => [participant.id, participant]));
  const creditors = balances.filter((balance) => balance.amount > 0).map((balance) => ({ ...balance }));
  const debtors = balances.filter((balance) => balance.amount < 0).map((balance) => ({ ...balance, amount: -balance.amount }));
  const byLargestThenId = (left: { id: string; amount: number }, right: { id: string; amount: number }) => right.amount - left.amount || left.id.localeCompare(right.id);
  creditors.sort(byLargestThenId);
  debtors.sort(byLargestThenId);

  const settlements: Settlement[] = [];
  let creditorIndex = 0;
  let debtorIndex = 0;
  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amount = Math.min(creditor.amount, debtor.amount);
    const from = participantsById.get(debtor.id);
    const to = participantsById.get(creditor.id);
    if (!from || !to || amount <= 0 || from.id === to.id) break;
    settlements.push({ from, to, amount });
    creditor.amount -= amount;
    debtor.amount -= amount;
    if (creditor.amount === 0) creditorIndex += 1;
    if (debtor.amount === 0) debtorIndex += 1;
  }

  return { totalAmount, includedExpenseCount, balances, settlements };
}

export function formatTwd(amount: number): string {
  return `NT$${Math.max(0, Math.round(amount)).toLocaleString("zh-TW")}`;
}

export function settlementText(result: SplitResult): string {
  const lines = [
    "分帳結算",
    `已計入 ${result.includedExpenseCount} 筆支出，合計 ${formatTwd(result.totalAmount)}`,
    "",
  ];
  if (result.settlements.length === 0) {
    lines.push(result.totalAmount === 0 ? "尚未有可結算的支出。" : "帳目已平衡，不需要轉帳。", "");
  } else {
    lines.push("轉帳建議");
    result.settlements.forEach((settlement, index) => lines.push(`${index + 1}. ${settlement.from.name} → ${settlement.to.name}：${formatTwd(settlement.amount)}`));
    lines.push("");
  }
  lines.push("各自淨額（＋應收／－應付）");
  result.balances.forEach((balance) => lines.push(`${balance.name}：${balance.amount >= 0 ? "+" : "−"}${formatTwd(Math.abs(balance.amount))}`));
  return lines.join("\n");
}
