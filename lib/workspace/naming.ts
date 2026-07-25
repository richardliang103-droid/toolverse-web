/**
 * 工作區的檔名處理。純函式，沒有任何瀏覽器 API。
 *
 * 工作區的規矩是「同名檔案不可互相覆蓋」——使用者把三張都叫 IMG_0001.jpg 的照片
 * 丟進來，應該看到三個項目，不是一個。
 */

// 只清路徑分隔字元與 Windows 不接受的字元。連字號、句點、括號、空白在檔名裡都很
// 常見，一併清掉只會讓使用者認不出自己的檔案（而且清掉句點會連副檔名一起毀掉）。
// 這個名字只用於顯示與下載存檔名：Blob 的儲存鍵一律由 id 產生，見 storageKeyFor()。
const UNSAFE_CHARACTERS = /[/\\:*?"<>|]/g;
/** 已經是「名字 (2)」形式時，續編要從 3 開始，而不是變成「名字 (2) (2)」。 */
const NUMBERED_SUFFIX = /^(.*?)\s\((\d+)\)$/;

/** 拆出主檔名與副檔名（含點）。開頭的點視為隱藏檔名而非副檔名。 */
export function splitFileName(name: string): { stem: string; extension: string | null } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return { stem: name, extension: null };
  return { stem: name.slice(0, dot), extension: name.slice(dot).toLowerCase() };
}

/**
 * 去掉不能出現在檔名裡的字元並收斂空白。
 * 全空的話給一個保底名字，因為沒有名字的項目在清單裡點不到也認不出來。
 */
export function safeFileName(name: string): string {
  const cleaned = name.replace(UNSAFE_CHARACTERS, "").replace(/\s+/g, " ").trim();
  return cleaned === "" || cleaned === "." || cleaned === ".." ? "未命名檔案" : cleaned.slice(0, 180);
}

/**
 * 在已用過的名字裡挑一個不衝突的：`a.png` → `a (2).png` → `a (3).png`。
 * 序號加在副檔名前面，這樣下載後檔案類型還是對的。
 */
export function uniqueFileName(taken: Iterable<string>, desired: string): string {
  const used = new Set<string>();
  for (const name of taken) used.add(name.toLowerCase());

  const safe = safeFileName(desired);
  if (!used.has(safe.toLowerCase())) return safe;

  const { stem, extension } = splitFileName(safe);
  const numbered = NUMBERED_SUFFIX.exec(stem);
  const base = numbered ? numbered[1] : stem;
  let counter = numbered ? Number(numbered[2]) + 1 : 2;

  // 上限只是防呆：正常情況下第一輪就找得到空位。
  for (; counter < 10_000; counter += 1) {
    const candidate = `${base} (${counter})${extension ?? ""}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (${Date.now()})${extension ?? ""}`;
}

/**
 * 產生 Blob 的儲存鍵。
 *
 * 刻意**不用檔名**：檔名可以重複、可以有各種奇怪字元，而且使用者之後可能想改名。
 * 用 id 當鍵，改名就只是改 metadata，不必搬動 Blob。
 */
export function storageKeyFor(id: string, extension: string | null): string {
  return extension ? `${id}${extension}` : id;
}
