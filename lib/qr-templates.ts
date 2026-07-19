export type WifiAuth = "WPA" | "WEP" | "nopass";

/** WIFI: 格式的特殊字元跳脫（\ ; , : "）。 */
function escapeWifi(value: string) {
  return value.replace(/([\\;,:"])/g, "\\$1");
}

/** vCard 值跳脫：\ → \\、換行 → \n、逗號與分號前加 \。 */
function escapeVcard(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
}

/** 手機掃描即可加入 Wi-Fi 的標準 payload（WIFI:T:WPA;S:ssid;P:pass;;）。 */
export function wifiPayload(ssid: string, password: string, auth: WifiAuth): string {
  const parts = [`T:${auth === "nopass" ? "nopass" : auth}`, `S:${escapeWifi(ssid.trim())}`];
  if (auth !== "nopass" && password) parts.push(`P:${escapeWifi(password)}`);
  return `WIFI:${parts.join(";")};;`;
}

export type VcardFields = { name: string; phone?: string; email?: string; org?: string; url?: string };

/** vCard 3.0：掃描後可直接存入通訊錄，空欄位不輸出。 */
export function vcardPayload(fields: VcardFields): string {
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${escapeVcard(fields.name.trim())}`];
  if (fields.phone?.trim()) lines.push(`TEL;TYPE=CELL:${escapeVcard(fields.phone.trim())}`);
  if (fields.email?.trim()) lines.push(`EMAIL:${escapeVcard(fields.email.trim())}`);
  if (fields.org?.trim()) lines.push(`ORG:${escapeVcard(fields.org.trim())}`);
  if (fields.url?.trim()) lines.push(`URL:${escapeVcard(fields.url.trim())}`);
  lines.push("END:VCARD");
  return lines.join("\n");
}

/** 掃描後開啟簡訊 App 並帶入號碼與內容。 */
export function smsPayload(phone: string, message: string): string {
  return `SMSTO:${phone.trim()}:${message.trim()}`;
}
