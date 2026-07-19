export const CATEGORIES = [
  { id: "chart", label: "圖表" },
  { id: "image", label: "圖片" },
  { id: "text", label: "文字" },
  { id: "random", label: "抽選分組" },
  { id: "utility", label: "實用" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export const tools = [
  { slug: "lottery", name: "隨機抽名單", description: "貼上名單，用安全隨機來源抽出一位或多位成員。", symbol: "✦", accent: "blue", status: "READY", category: "random" },
  { slug: "background-remover", name: "圖片去背", description: "在瀏覽器本機免費移除背景，或切換 remove.bg API 取得更高畫質，下載透明 PNG。", symbol: "◐", accent: "coral", status: "READY", category: "image" },
  { slug: "ai-flowchart", name: "流程圖", description: "用中文描述流程，自動驗證並匯出 Mermaid、PNG、SVG 與 draw.io。", symbol: "⌘", accent: "mint", status: "BETA", category: "chart" },
  { slug: "gantt", name: "甘特圖", description: "拖曳排出專案時程：群組、里程碑與依賴關係，匯出 PNG、CSV、Mermaid 與 JSON。", symbol: "▤", accent: "fuji", status: "BETA", category: "chart" },
  { slug: "random-groups", name: "隨機分組", description: "貼上名單，公平隨機分成小組：可指定組數或每組人數，結果可複製或下載 CSV。", symbol: "⁘", accent: "toki", status: "READY", category: "random" },
  { slug: "image-compressor", name: "圖片壓縮", description: "本機批次壓縮與轉檔：JPG、PNG、WebP，可調品質與尺寸，圖片不上傳。", symbol: "◱", accent: "sora", status: "READY", category: "image" },
  { slug: "qr-code", name: "QR Code 產生器", description: "即時產生 QR Code，自訂顏色與容錯等級，下載 PNG、SVG 或直接複製。", symbol: "▦", accent: "sumi", status: "READY", category: "utility" },
  { slug: "countdown-timer", name: "倒數計時器", description: "活動與簡報用的全螢幕倒數：快速預設、警示變色、結束提示音。", symbol: "◷", accent: "matsuba", status: "READY", category: "utility" },
  { slug: "pdf-toolkit", name: "PDF 合併與取頁", description: "在瀏覽器本機合併多份 PDF、取出指定頁面，檔案不上傳。", symbol: "⧉", accent: "fuji", status: "BETA", category: "utility" },
  { slug: "text-cleaner", name: "文字清理", description: "去空白、去重複行、排序與全形轉半形，即時統計字數，內容不上傳。", symbol: "¶", accent: "mint", status: "READY", category: "text" },
  { slug: "exif-cleaner", name: "照片隱私清除", description: "無損移除 EXIF、GPS 位置與拍攝資訊，畫質不變，照片不上傳。", symbol: "◉", accent: "coral", status: "READY", category: "image" },
  { slug: "chinese-converter", name: "繁簡轉換", description: "OpenCC 繁簡互轉，支援台灣用詞（軟件→軟體），本機處理不上傳。", symbol: "繁", accent: "blue", status: "READY", category: "text" },
  { slug: "password-generator", name: "密碼產生器", description: "Web Crypto 安全隨機產生高強度密碼，可調長度與字元類別，不上傳不儲存。", symbol: "⁂", accent: "sumi", status: "READY", category: "utility" },
  { slug: "favicon-generator", name: "Favicon 產生器", description: "用文字、emoji 或圖片產生整套 favicon，附 HTML 與 manifest 片段。", symbol: "◆", accent: "sora", status: "READY", category: "image" },
  { slug: "barcode", name: "條碼產生器", description: "Code 128 與 EAN-13 條碼，自動計算檢查碼，下載 PNG、SVG，本機產生。", symbol: "▮", accent: "sumi", status: "READY", category: "utility" },
  { slug: "unit-converter", name: "單位換算", description: "長度、面積、重量、容量、溫度、速度即時換算，支援坪、甲、台斤等台制單位。", symbol: "⇄", accent: "matsuba", status: "READY", category: "utility" },
  { slug: "image-crop", name: "圖片裁切", description: "自由框選或固定比例裁切圖片，輸出 PNG、JPG，圖片不上傳。", symbol: "◫", accent: "toki", status: "READY", category: "image" },
  { slug: "text-compare", name: "文字比較", description: "比較兩段文字差異：逐行、逐詞、逐字，標示新增刪除與修改，本機比較。", symbol: "≒", accent: "fuji", status: "READY", category: "text" },
  { slug: "markdown-editor", name: "Markdown 編輯器", description: "即時預覽、支援 GFM 表格與程式碼，草稿自動儲存，可下載 .md 或複製 HTML。", symbol: "✎", accent: "sora", status: "READY", category: "text" },
  { slug: "csv-editor", name: "CSV 編輯器", description: "貼上或開啟 CSV／TSV 直接編輯、排序、增刪欄列，匯出 CSV 或 JSON。", symbol: "☰", accent: "mint", status: "READY", category: "utility" },
  { slug: "image-converter", name: "圖片格式轉換", description: "批次把 JPG、PNG、GIF、BMP、SVG 轉成 WebP、PNG、JPG，可調品質。", symbol: "⇋", accent: "coral", status: "READY", category: "image" },
  { slug: "audio-trimmer", name: "音訊剪輯", description: "看著波形框出片段、先試聽再輸出無損 WAV，MP3、WAV 等格式不上傳。", symbol: "♪", accent: "matsuba", status: "READY", category: "utility" },
] as const;

export type Tool = (typeof tools)[number];

function categoryLabel(id: CategoryId): string {
  return CATEGORIES.find((category) => category.id === id)?.label ?? "";
}

/** 首頁搜尋／分類過濾。query 比對名稱、描述、slug 與分類名，不分大小寫。 */
export function filterTools(query: string, category: CategoryId | "all"): Tool[] {
  const keyword = query.trim().toLowerCase();
  return tools.filter((tool) => {
    if (category !== "all" && tool.category !== category) return false;
    if (keyword === "") return true;
    const haystack = `${tool.name} ${tool.description} ${tool.slug} ${categoryLabel(tool.category)}`.toLowerCase();
    return haystack.includes(keyword);
  });
}
