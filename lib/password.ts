export type PasswordOptions = {
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
  excludeSimilar: boolean;
};

export const PASSWORD_MIN = 4;
export const PASSWORD_MAX = 128;

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?/";
// 容易看錯的字元：0/O、1/l/I，加上易混的 5/S、2/Z、B/8。
const SIMILAR = new Set("O0oIl1|5S2Z8B");

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: 16,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  excludeSimilar: false,
};

/** 各字元類別在套用「排除相似字」後的可用字集。 */
export function characterClasses(options: PasswordOptions): string[] {
  const filter = (source: string) => (options.excludeSimilar ? [...source].filter((char) => !SIMILAR.has(char)).join("") : source);
  const classes: string[] = [];
  if (options.lowercase) classes.push(filter(LOWER));
  if (options.uppercase) classes.push(filter(UPPER));
  if (options.digits) classes.push(filter(DIGITS));
  if (options.symbols) classes.push(filter(SYMBOLS));
  return classes.filter((set) => set.length > 0);
}

/** 均勻的密碼學隨機整數（rejection sampling，避免 modulo bias）。 */
function cryptoRandomInt(maxExclusive: number) {
  if (maxExclusive <= 0) throw new Error("maxExclusive 必須為正");
  const range = 0x1_0000_0000;
  const limit = range - (range % maxExclusive);
  const values = new Uint32Array(1);
  do { crypto.getRandomValues(values); } while (values[0] >= limit);
  return values[0] % maxExclusive;
}

function pick(source: string) {
  return source[cryptoRandomInt(source.length)];
}

function shuffle<T>(items: T[]) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = cryptoRandomInt(index + 1);
    [items[index], items[swap]] = [items[swap], items[index]];
  }
  return items;
}

/**
 * 產生密碼：先從每個選取的字元類別各取一個字（保證都出現），
 * 其餘由全部字元池補齊，最後洗牌打散順序。
 */
export function generatePassword(options: PasswordOptions): string {
  const classes = characterClasses(options);
  if (classes.length === 0) throw new Error("請至少選擇一種字元類別");
  const length = Math.min(Math.max(Math.round(options.length), PASSWORD_MIN), PASSWORD_MAX);
  const pool = classes.join("");
  const chars: string[] = classes.map((set) => pick(set));
  while (chars.length < length) chars.push(pick(pool));
  return shuffle(chars).join("");
}

/** 密碼熵（bits）＝ 長度 × log2(字元池大小)。 */
export function passwordEntropyBits(options: PasswordOptions): number {
  const poolSize = characterClasses(options).reduce((sum, set) => sum + set.length, 0);
  if (poolSize <= 1) return 0;
  const length = Math.min(Math.max(Math.round(options.length), PASSWORD_MIN), PASSWORD_MAX);
  return Math.round(length * Math.log2(poolSize));
}

export type StrengthLevel = "weak" | "fair" | "strong" | "excellent";

/** 依熵值給強度等級與中文標籤。 */
export function passwordStrength(bits: number): { level: StrengthLevel; label: string } {
  if (bits < 40) return { level: "weak", label: "偏弱" };
  if (bits < 60) return { level: "fair", label: "普通" };
  if (bits < 100) return { level: "strong", label: "強" };
  return { level: "excellent", label: "非常強" };
}
