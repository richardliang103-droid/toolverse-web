/**
 * 把偵測結果換成工具推薦。純函式，實際依賴的資料是 `lib/tool-manifest.ts`。
 *
 * 「這個格式哪些工具吃得下」永遠查 manifest（`toolsAcceptingFile`／`toolsAcceptingText`），
 * 不在這裡另外抄一份 slug 清單——manifest 才是唯一真相，這裡只重新排序、補一句
 * 給使用者看的理由。這樣工具的 `inputs` 改了，推薦名單會自動跟著改，不會漂移。
 *
 * 檔案與文字的策略不同：
 * - 檔案：manifest 對同一種 MIME 常常有好幾個工具都吃得下（例如 PNG 有六、七個），
 *   策展表只負責排順序、給理由；沒被策展表提到的工具還是會出現在完整清單裡。
 * - 文字：manifest 只分得出「吃不吃純文字」，分不出「這段文字實際上是什麼」，
 *   所以策展表才是唯一的推薦依據——沒有命中就不推薦，不要為了湊三個硬推。
 */
import type { FileCategory } from "./signatures.ts";
import { CATEGORY_LABELS } from "./signatures.ts";
import type { FileTypeDetection } from "./detect-file.ts";
import type { IntakeTextType, TextTypeDetection } from "./detect-text.ts";
import { getToolManifest, toolsAcceptingFile, toolsAcceptingText } from "../tool-manifest.ts";
import type { IntakeDetection, IntakeRecommendation } from "./types.ts";

const MAX_RECOMMENDED = 3;

interface CuratedEntry {
  slug: string;
  reason: string;
}

const FILE_PRIORITY: Partial<Record<FileCategory, CuratedEntry[]>> = {
  image: [
    { slug: "exif-cleaner", reason: "先移除 EXIF、GPS 等隱私資訊" },
    { slug: "image-compressor", reason: "壓縮檔案大小，適合分享" },
    { slug: "image-converter", reason: "轉成 WebP、PNG 或 JPG" },
    { slug: "image-crop", reason: "自由裁切或調整比例" },
    { slug: "background-remover", reason: "去除背景，輸出透明 PNG" },
    { slug: "favicon-generator", reason: "做成網站 favicon" },
    { slug: "qr-code", reason: "當成 QR Code 中央的 logo" },
  ],
  pdf: [{ slug: "pdf-toolkit", reason: "合併多份 PDF 或取出指定頁面" }],
  audio: [{ slug: "audio-trimmer", reason: "剪輯片段或合併多段音訊" }],
  csv: [
    { slug: "csv-editor", reason: "編輯表格、排序，匯出 CSV 或 JSON" },
    { slug: "gantt", reason: "匯入成甘特圖的時程資料" },
  ],
  json: [{ slug: "gantt", reason: "匯入成甘特圖的時程資料" }],
};

const TEXT_PRIORITY: Partial<Record<IntakeTextType, CuratedEntry[]>> = {
  markdown: [
    { slug: "markdown-editor", reason: "即時預覽 Markdown 排版" },
    { slug: "text-cleaner", reason: "整理多餘空白與換行" },
  ],
  csv: [{ slug: "csv-editor", reason: "貼上就是表格，可排序、匯出" }],
  json: [{ slug: "text-compare", reason: "比較兩份 JSON 內容的差異" }],
  url: [{ slug: "qr-code", reason: "把這個網址變成 QR Code" }],
  "name-list": [
    { slug: "random-groups", reason: "把名單隨機分成小組" },
    { slug: "lottery", reason: "從名單抽出一位或多位" },
  ],
  "date-list": [{ slug: "text-cleaner", reason: "整理成統一格式後再使用" }],
  base64: [{ slug: "text-cleaner", reason: "先去除多餘空白再處理" }],
  paragraph: [{ slug: "text-cleaner", reason: "去空白、去重複行、排序" }],
};

/**
 * 把「策展表」與「manifest 實際宣告吃得下的工具」合併成一份排序清單：
 * 策展表裡的排前面（依表裡順序），其餘 declared 工具照 manifest 順序接在後面。
 * 策展表指到 manifest 沒宣告的 slug 不會出現——保證這份清單不會漂移。
 */
function rankDeclared(declaredSlugs: readonly string[], curated: CuratedEntry[] | undefined, fallbackReason: (slug: string) => string): IntakeRecommendation[] {
  const declared = new Set(declaredSlugs);
  const curatedList = (curated ?? []).filter((entry) => declared.has(entry.slug));
  const curatedSlugs = new Set(curatedList.map((entry) => entry.slug));
  const ranked: IntakeRecommendation[] = curatedList.map((entry, index) => ({
    slug: entry.slug,
    reason: entry.reason,
    score: Math.max(0.5, 1 - index * 0.15),
  }));
  for (const slug of declaredSlugs) {
    if (curatedSlugs.has(slug)) continue;
    ranked.push({ slug, reason: fallbackReason(slug), score: 0.3 });
  }
  return ranked;
}

export function recommendToolsForFile(detection: FileTypeDetection): { recommendedTools: IntakeRecommendation[]; allTools: IntakeRecommendation[] } {
  if (detection.category === "unknown") return { recommendedTools: [], allTools: [] };
  const declared = toolsAcceptingFile(detection.mimeType, detection.extension ?? undefined).map((manifest) => manifest.slug);
  const allTools = rankDeclared(declared, FILE_PRIORITY[detection.category], () => `支援 ${detection.label}`);
  return { recommendedTools: allTools.slice(0, MAX_RECOMMENDED), allTools };
}

export function recommendToolsForText(detection: TextTypeDetection): { recommendedTools: IntakeRecommendation[]; allTools: IntakeRecommendation[] } {
  if (detection.type === "empty") return { recommendedTools: [], allTools: [] };
  const declared = toolsAcceptingText().map((manifest) => manifest.slug);
  const curated = TEXT_PRIORITY[detection.type];
  const allTools = rankDeclared(declared, curated, (slug) => `${getToolManifest(slug)?.name ?? slug} 可以處理貼上的文字`);
  // manifest 只分得出「吃不吃文字」，分不出「這段文字實際上是什麼」——凡是
  // 策展表沒點名的工具，都只能算「湊數」，絕不能混進推薦裡當作前三名。
  // 只取策展命中的數量，不足三個就是不足三個，不拿其餘的墊。
  const curatedCount = curated?.filter((entry) => declared.includes(entry.slug)).length ?? 0;
  const recommendedTools = allTools.slice(0, Math.min(curatedCount, MAX_RECOMMENDED));
  return { recommendedTools, allTools };
}

export function buildFileIntakeDetection(detection: FileTypeDetection): IntakeDetection {
  const { recommendedTools, allTools } = recommendToolsForFile(detection);
  return { kind: "file", type: detection.mimeType, label: detection.label, confidence: detection.confidence, recommendedTools, allTools };
}

const TEXT_TYPE_LABELS: Record<IntakeTextType, string> = {
  mermaid: "Mermaid 圖表原始碼",
  json: "JSON 資料",
  markdown: "Markdown 文件",
  url: "網址",
  base64: "Base64 編碼內容",
  csv: "CSV／TSV 表格",
  "date-list": "日期清單",
  "name-list": "名單",
  paragraph: "一般文字",
  empty: "空白內容",
};

export function buildTextIntakeDetection(detection: TextTypeDetection): IntakeDetection {
  const { recommendedTools, allTools } = recommendToolsForText(detection);
  return { kind: "text", type: detection.type, label: TEXT_TYPE_LABELS[detection.type], confidence: detection.confidence, recommendedTools, allTools };
}

export { CATEGORY_LABELS };
