export function normalizeParticipants(rawText: string, removeDuplicates = true) {
  const participants = rawText.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  return removeDuplicates ? [...new Set(participants)] : participants;
}

function cryptoRandomIndex(maxExclusive: number) {
  const range = 0x1_0000_0000;
  const limit = range - (range % maxExclusive);
  const values = new Uint32Array(1);
  do { crypto.getRandomValues(values); } while (values[0] >= limit);
  return values[0] % maxExclusive;
}

/** Fisher–Yates 洗牌，使用 Web Crypto 的安全隨機來源。 */
export function cryptoShuffle<T>(items: T[]) {
  const pool = [...items];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const randomIndex = cryptoRandomIndex(index + 1);
    [pool[index], pool[randomIndex]] = [pool[randomIndex], pool[index]];
  }
  return pool;
}

export function drawWinners(participants: string[], count: number) {
  if (!Number.isInteger(count) || count < 1) throw new Error("抽出人數至少要有 1 位");
  if (count > participants.length) throw new Error("抽出人數不能超過可抽選人數");
  return cryptoShuffle(participants).slice(0, count);
}
