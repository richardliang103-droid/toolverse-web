export type Participant = { id: string; label: string };

/** 每一行都是一張獨立的籤；id 不能以顯示名稱取代，否則同名者會互相影響。 */
export function normalizeParticipants(rawText: string, removeDuplicates = true): Participant[] {
  const lines = rawText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  const labels = removeDuplicates ? lines.filter((label, index) => lines.indexOf(label) === index) : lines;
  const occurrences = new Map<string, number>();
  return labels.map((label) => {
    const occurrence = occurrences.get(label) ?? 0;
    occurrences.set(label, occurrence + 1);
    return { id: `${label}\u0000${occurrence}`, label };
  });
}

/**
 * 舊版儲存的是得獎者「名稱」清單（previousWinners）；新版依籤的 id 排除。
 * 一次性遷移：同名者依出現順序對應到第 N 張籤，與 normalizeParticipants 的 id 規則一致。
 */
export function migrateLegacyWinnerNames(names: string[]): string[] {
  const occurrences = new Map<string, number>();
  return names.map((name) => {
    const occurrence = occurrences.get(name) ?? 0;
    occurrences.set(name, occurrence + 1);
    return `${name}\u0000${occurrence}`;
  });
}

function cryptoRandomIndex(maxExclusive: number) {
  const range = 0x1_0000_0000;
  const limit = range - (range % maxExclusive);
  const values = new Uint32Array(1);
  do { crypto.getRandomValues(values); } while (values[0] >= limit);
  return values[0] % maxExclusive;
}

export function drawWinners<T>(participants: T[], count: number): T[] {
  if (!Number.isInteger(count) || count < 1) throw new Error("抽出人數至少要有 1 位");
  if (count > participants.length) throw new Error("抽出人數不能超過可抽選人數");
  const pool = [...participants];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const randomIndex = cryptoRandomIndex(index + 1);
    [pool[index], pool[randomIndex]] = [pool[randomIndex], pool[index]];
  }
  return pool.slice(0, count);
}
