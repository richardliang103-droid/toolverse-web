export type BarcodeFormat = "CODE128" | "EAN13";

/** EAN-13 檢查碼：前 12 碼奇位×1、偶位×3，補到 10 的倍數。 */
export function ean13Checksum(digits12: string): number {
  const sum = digits12.split("").reduce((total, char, index) => total + Number(char) * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

/**
 * 驗證輸入；回傳可編碼的最終內容（EAN-13 給 12 碼會自動補檢查碼），
 * 不合法時回傳使用者可讀的錯誤訊息。
 */
export function validateBarcode(format: BarcodeFormat, raw: string): { value?: string; error?: string } {
  const text = raw.trim();
  if (!text) return { error: "請輸入條碼內容" };
  if (format === "CODE128") {
    if (text.length > 80) return { error: "內容過長（上限 80 字元）" };
    if (!/^[\x20-\x7e]+$/.test(text)) return { error: "Code 128 只支援英數字與常見符號（不含中文）" };
    return { value: text };
  }
  if (!/^\d{12,13}$/.test(text)) return { error: "EAN-13 需要 12 或 13 位數字" };
  const body = text.slice(0, 12);
  const check = ean13Checksum(body);
  if (text.length === 13 && Number(text[12]) !== check) {
    return { error: `檢查碼不符：最後一碼應為 ${check}` };
  }
  return { value: body + String(check) };
}

export function barcodeFilename(value: string): string {
  const safe = value.replace(/[^\w一-鿿-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return safe || "barcode";
}
