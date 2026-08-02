/**
 * Tool Manifest v2 —— 全站唯一的工具註冊表。
 *
 * 在這之前，`lib/tools.ts` 只記了「畫成卡片需要的欄位」（名稱、描述、符號、
 * 配色、分類）。首頁、⌘K 命令面板與 sitemap 都讀它，所以工具「有哪些」從來
 * 沒有分歧；但工具「能吃什麼、會吐什麼、算在哪裡跑」這些事實散在各個
 * `app/tools/*` 元件裡，只有打開原始碼才看得到。
 *
 * 少了那些事實，就沒辦法做「拖進一個檔案，站台自己判斷哪些工具接得住」，
 * 也沒辦法讓工具之間彼此推薦。這個模組把它們集中成可驗證的資料。
 *
 * 規矩：
 * - 這裡是唯一真相。`lib/tools.ts` 從這份 manifest 推導出舊的卡片欄位，
 *   不另外抄一份（兩份清單遲早會漂移）。
 * - 純資料、零依賴，用 `node --test --experimental-strip-types` 驗證。
 * - 內容必須與實際程式碼相符：上限數字、MIME、隱私模式都是從工具原始碼
 *   核對出來的，改工具時要一起改這裡，`tests/tool-manifest.test.mjs` 會擋。
 */

export const CATEGORIES = [
  { id: "chart", label: "圖表" },
  { id: "image", label: "圖片" },
  { id: "text", label: "文字" },
  { id: "random", label: "抽選分組" },
  { id: "utility", label: "實用" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

/** 卡片配色，對應 `app/globals.css` 的 `.compact-tool-*`（和色系）。 */
export const ACCENTS = ["blue", "coral", "mint", "fuji", "toki", "sora", "sumi", "matsuba"] as const;
export type AccentId = (typeof ACCENTS)[number];

export const TOOL_STATUSES = ["active", "beta", "planned"] as const;
export type ToolStatus = (typeof TOOL_STATUSES)[number];

/** 運算發生在哪裡。`hybrid` 代表使用者可以在頁面上切換。 */
export const PROCESSING_MODES = ["local", "remote", "hybrid"] as const;
export type ToolProcessingMode = (typeof PROCESSING_MODES)[number];

export const TOOL_ENGINES = ["native", "web-worker", "wasm", "webgpu", "webcodecs", "remote-api"] as const;
export type ToolEngine = (typeof TOOL_ENGINES)[number];

export const CAPABILITY_KINDS = ["file", "text", "structured-data"] as const;
export type ToolCapabilityKind = (typeof CAPABILITY_KINDS)[number];

/**
 * 隱私標示。四種說法是刻意窮舉的——含糊的「安全處理」不算數，
 * 使用者要能一眼看出檔案會不會離開瀏覽器。
 */
export const PRIVACY_LEVELS = ["local-only", "local-after-download", "third-party", "conditional"] as const;
export type ToolPrivacyLevel = (typeof PRIVACY_LEVELS)[number];

export const PRIVACY_LABELS: Record<ToolPrivacyLevel, string> = {
  "local-only": "完全本機處理",
  "local-after-download": "本機處理，首次需下載模型",
  "third-party": "檔案會傳送至第三方服務",
  conditional: "混合模式，依目前選項決定",
};

export interface ToolInputCapability {
  kind: ToolCapabilityKind;
  mimeTypes?: string[];
  extensions?: string[];
  /** 一次最多幾個檔案；沒寫代表工具沒有明確上限（多半是純文字輸入）。 */
  maxFiles?: number;
  /** 單一檔案上限，與工具內的 MAX_SIZE 對齊。 */
  maxSizeBytes?: number;
}

export interface ToolOutputCapability {
  kind: ToolCapabilityKind;
  mimeTypes?: string[];
  extensions?: string[];
}

export interface ToolHandoffCapability {
  /** 這個工具的結果是否有送往其他工具的入口。 */
  canSend: boolean;
  /** 這個工具是否有接收其他工具內容的入口。 */
  canReceive: boolean;
  /** 接力的資料種類；是收、送兩者的聯集。 */
  kinds: ToolCapabilityKind[];
}

export interface ToolManifest {
  slug: string;
  name: string;
  description: string;
  category: CategoryId;
  symbol: string;
  accent: AccentId;
  status: ToolStatus;

  processing: ToolProcessingMode;
  engines: ToolEngine[];

  inputs: ToolInputCapability[];
  outputs: ToolOutputCapability[];

  /** 一次能處理多個輸入（不是「可以重複執行」）。 */
  supportsBatch: boolean;
  /** 已接上本機 Workspace（存檔／取檔）。PR 2 之前全部是 false。 */
  supportsWorkspace: boolean;
  /** 能當成 Recipe 的一個步驟執行。Recipe engine 尚未實作，全部是 false。 */
  supportsRecipe: boolean;
  /** 斷線也能用：不需要任何網路請求（含首次的模型／字典下載）。 */
  supportsOffline: boolean;

  /** 工具接力的實際接線狀態；由測試對照工具頁中的 hook／按鈕。 */
  handoff: ToolHandoffCapability;

  /** 處理完之後最可能想接的下一站，用於工具接力與推薦。 */
  suggestedNextTools: string[];

  privacy: ToolPrivacyLevel;
  /** 給使用者看的一句話，說明資料到底去了哪裡。 */
  privacyNote: string;
}

const MB = 1024 * 1024;

/**
 * 陣列順序＝首頁卡片順序。要調整版面就調這裡，別在 `lib/tools.ts` 另外排序。
 */
export const toolManifests: readonly ToolManifest[] = [
  {
    slug: "lottery",
    name: "隨機抽名單",
    description: "貼上名單，用安全隨機來源抽出一位或多位成員。",
    category: "random",
    symbol: "✦",
    accent: "blue",
    status: "active",
    processing: "local",
    engines: ["native"],
    inputs: [{ kind: "text" }],
    outputs: [{ kind: "text" }],
    supportsBatch: false,
    supportsWorkspace: false,
    supportsRecipe: false,
    supportsOffline: true,
    handoff: { canSend: false, canReceive: false, kinds: [] },
    suggestedNextTools: ["random-groups"],
    privacy: "local-only",
    privacyNote: "名單、設定與抽出紀錄只留在這台裝置的 localStorage。",
  },
  {
    slug: "background-remover",
    name: "圖片去背",
    description: "在瀏覽器本機免費移除背景，或切換 remove.bg API 取得更高畫質，下載透明 PNG。",
    category: "image",
    symbol: "◐",
    accent: "coral",
    status: "active",
    processing: "hybrid",
    engines: ["web-worker", "webgpu", "wasm", "remote-api"],
    inputs: [{ kind: "file", mimeTypes: ["image/jpeg", "image/png", "image/webp"], maxFiles: 1, maxSizeBytes: 10 * MB }],
    outputs: [{ kind: "file", mimeTypes: ["image/png"], extensions: [".png"] }],
    supportsBatch: false,
    supportsWorkspace: false,
    supportsRecipe: false,
    supportsOffline: false,
    handoff: { canSend: true, canReceive: true, kinds: ["file"] },
    suggestedNextTools: ["image-compressor", "image-converter", "image-crop"],
    privacy: "conditional",
    privacyNote: "預設用本機 AI（首次需下載 RMBG-1.4 模型）；切到 remove.bg 模式時，圖片與金鑰會經本站 API 轉送到 remove.bg。",
  },
  {
    slug: "ai-flowchart",
    name: "流程圖",
    description: "用中文描述流程，自動驗證並匯出 Mermaid、PNG、SVG 與 draw.io。",
    category: "chart",
    symbol: "⌘",
    accent: "mint",
    status: "beta",
    processing: "remote",
    engines: ["remote-api", "native"],
    inputs: [{ kind: "text" }],
    outputs: [
      { kind: "text", mimeTypes: ["text/vnd.mermaid"] },
      { kind: "file", mimeTypes: ["image/png", "image/svg+xml", "application/xml"], extensions: [".png", ".svg", ".drawio.xml"] },
    ],
    supportsBatch: false,
    supportsWorkspace: false,
    supportsRecipe: false,
    supportsOffline: false,
    handoff: { canSend: false, canReceive: false, kinds: [] },
    suggestedNextTools: ["markdown-editor"],
    privacy: "third-party",
    privacyNote: "流程描述會由瀏覽器直接送往你選擇的 Gemini 或 OpenAI，不經過本站伺服器；金鑰只暫存在頁面記憶體。",
  },
  {
    slug: "gantt",
    name: "甘特圖",
    description: "拖曳排出專案時程：群組、里程碑與依賴關係，匯出 PNG、CSV、Mermaid 與 JSON。",
    category: "chart",
    symbol: "▤",
    accent: "fuji",
    status: "beta",
    processing: "local",
    engines: ["native"],
    inputs: [
      { kind: "file", mimeTypes: ["application/json", "text/csv"], extensions: [".json", ".csv"], maxFiles: 1 },
      { kind: "structured-data" },
    ],
    outputs: [
      { kind: "file", mimeTypes: ["image/png", "image/svg+xml", "text/csv", "application/json"], extensions: [".png", ".svg", ".csv", ".json"] },
      { kind: "text", mimeTypes: ["text/vnd.mermaid"] },
    ],
    supportsBatch: false,
    supportsWorkspace: false,
    supportsRecipe: false,
    supportsOffline: true,
    handoff: { canSend: false, canReceive: false, kinds: [] },
    suggestedNextTools: ["csv-editor"],
    privacy: "local-only",
    privacyNote: "時程只存在瀏覽器 localStorage，匯出檔案也在本機產生。",
  },
  {
    slug: "equity-chart",
    name: "股權架構圖",
    description: "輸入股東與持股比例，自動畫出分層股權架構，標示境外公司與公司狀態，適合企業徵信報告。",
    category: "chart",
    symbol: "◈",
    accent: "sumi",
    status: "beta",
    processing: "local",
    engines: ["native"],
    inputs: [
      { kind: "file", mimeTypes: ["application/json"], extensions: [".json"], maxFiles: 1 },
      { kind: "structured-data" },
    ],
    outputs: [{ kind: "file", mimeTypes: ["image/png", "image/svg+xml", "application/json"], extensions: [".png", ".svg", ".json"] }],
    supportsBatch: false,
    supportsWorkspace: false,
    supportsRecipe: false,
    supportsOffline: true,
    handoff: { canSend: false, canReceive: false, kinds: [] },
    suggestedNextTools: ["operations-chart"],
    privacy: "local-only",
    privacyNote: "股東、公司與持股資料只留在這台裝置的 localStorage，匯出檔案也在本機產生。",
  },
  {
    slug: "operations-chart",
    name: "營運架構圖",
    description: "輸入上下游往來對象與佔比，自動畫出三欄營運架構，標示付款條件與關係人交易，適合企業徵信報告。",
    category: "chart",
    symbol: "⇌",
    accent: "toki",
    status: "beta",
    processing: "local",
    engines: ["native"],
    inputs: [
      { kind: "file", mimeTypes: ["application/json"], extensions: [".json"], maxFiles: 1 },
      { kind: "structured-data" },
    ],
    outputs: [{ kind: "file", mimeTypes: ["image/png", "image/svg+xml", "application/json"], extensions: [".png", ".svg", ".json"] }],
    supportsBatch: false,
    supportsWorkspace: false,
    supportsRecipe: false,
    supportsOffline: true,
    handoff: { canSend: false, canReceive: false, kinds: [] },
    suggestedNextTools: ["equity-chart"],
    privacy: "local-only",
    privacyNote: "上下游往來對象與佔比只留在這台裝置的 localStorage，匯出檔案也在本機產生。",
  },
  {
    slug: "random-groups",
    name: "隨機分組",
    description: "貼上名單，公平隨機分成小組：可指定組數或每組人數，結果可複製或下載 CSV。",
    category: "random",
    symbol: "⁘",
    accent: "toki",
    status: "active",
    processing: "local",
    engines: ["native"],
    inputs: [{ kind: "text" }],
    outputs: [
      { kind: "text" },
      { kind: "file", mimeTypes: ["text/csv"], extensions: [".csv"] },
    ],
    supportsBatch: false,
    supportsWorkspace: false,
    supportsRecipe: false,
    supportsOffline: true,
    handoff: { canSend: false, canReceive: false, kinds: [] },
    suggestedNextTools: ["lottery", "text-cleaner"],
    privacy: "local-only",
    privacyNote: "名單只在瀏覽器裡分組，不會傳出去。",
  },
  {
    slug: "image-compressor",
    name: "圖片壓縮",
    description: "本機批次壓縮與轉檔：JPG、PNG、WebP，可調品質與尺寸，圖片不上傳。",
    category: "image",
    symbol: "◱",
    accent: "sora",
    status: "active",
    processing: "local",
    engines: ["native"],
    inputs: [{ kind: "file", mimeTypes: ["image/jpeg", "image/png", "image/webp"], maxFiles: 20, maxSizeBytes: 25 * MB }],
    outputs: [{ kind: "file", mimeTypes: ["image/jpeg", "image/png", "image/webp", "application/zip"], extensions: [".jpg", ".png", ".webp", ".zip"] }],
    supportsBatch: true,
    supportsWorkspace: false,
    supportsRecipe: false,
    supportsOffline: true,
    handoff: { canSend: true, canReceive: true, kinds: ["file"] },
    suggestedNextTools: ["image-converter", "exif-cleaner", "image-crop"],
    privacy: "local-only",
    privacyNote: "壓縮全程用 Canvas 在本機完成，圖片不會離開瀏覽器。",
  },
  {
    slug: "qr-code",
    name: "QR Code 產生器",
    description: "即時產生 QR Code，自訂顏色與容錯等級，下載 PNG、SVG 或直接複製。",
    category: "utility",
    symbol: "▦",
    accent: "sumi",
    status: "active",
    processing: "local",
    engines: ["native"],
    inputs: [
      { kind: "text" },
      { kind: "file", mimeTypes: ["image/png", "image/jpeg", "image/svg+xml", "image/webp"], maxFiles: 1, maxSizeBytes: 2 * MB },
    ],
    outputs: [{ kind: "file", mimeTypes: ["image/png", "image/svg+xml"], extensions: [".png", ".svg"] }],
    supportsBatch: false,
    supportsWorkspace: false,
    supportsRecipe: false,
    supportsOffline: true,
    handoff: { canSend: false, canReceive: false, kinds: [] },
    suggestedNextTools: ["image-compressor"],
    privacy: "local-only",
    privacyNote: "QR 內容與 logo 圖片都在本機編碼，不會上傳。",
  },
  {
    slug: "countdown-timer",
    name: "倒數計時器",
    description: "活動與簡報用的全螢幕倒數：快速預設、警示變色、結束提示音。",
    category: "utility",
    symbol: "◷",
    accent: "matsuba",
    status: "active",
    processing: "local",
    engines: ["native"],
    inputs: [{ kind: "structured-data" }],
    outputs: [],
    supportsBatch: false,
    supportsWorkspace: false,
    supportsRecipe: false,
    supportsOffline: true,
    handoff: { canSend: false, canReceive: false, kinds: [] },
    suggestedNextTools: ["calendar"],
    privacy: "local-only",
    privacyNote: "計時設定只存在這台裝置。",
  },
  {
    slug: "pdf-toolkit",
    name: "PDF 合併與取頁",
    description: "在瀏覽器本機合併多份 PDF、取出指定頁面，檔案不上傳。",
    category: "utility",
    symbol: "⧉",
    accent: "fuji",
    status: "beta",
    processing: "local",
    engines: ["native", "web-worker"],
    inputs: [{ kind: "file", mimeTypes: ["application/pdf"], extensions: [".pdf"], maxFiles: 12, maxSizeBytes: 50 * MB }],
    outputs: [{ kind: "file", mimeTypes: ["application/pdf"], extensions: [".pdf"] }],
    supportsBatch: true,
    supportsWorkspace: true,
    supportsRecipe: false,
    supportsOffline: true,
    handoff: { canSend: false, canReceive: false, kinds: [] },
    suggestedNextTools: [],
    privacy: "local-only",
    privacyNote: "合併、取頁與縮圖都用 pdf-lib／pdf.js 在本機完成，適合合約這類敏感文件。",
  },
  {
    slug: "text-cleaner",
    name: "文字清理",
    description: "去空白、去重複行、排序與全形轉半形，即時統計字數，內容不上傳。",
    category: "text",
    symbol: "¶",
    accent: "mint",
    status: "active",
    processing: "local",
    engines: ["native"],
    inputs: [{ kind: "text" }],
    outputs: [
      { kind: "text" },
      { kind: "file", mimeTypes: ["text/plain"], extensions: [".txt"] },
    ],
    supportsBatch: false,
    supportsWorkspace: true,
    supportsRecipe: false,
    supportsOffline: true,
    handoff: { canSend: true, canReceive: true, kinds: ["text"] },
    suggestedNextTools: ["random-groups", "chinese-converter", "text-compare"],
    privacy: "local-only",
    privacyNote: "文字只在瀏覽器裡處理，不會傳出去。",
  },
  {
    slug: "exif-cleaner",
    name: "照片隱私清除",
    description: "無損移除 EXIF、GPS 位置與拍攝資訊，畫質不變，照片不上傳。",
    category: "image",
    symbol: "◉",
    accent: "coral",
    status: "active",
    processing: "local",
    engines: ["native"],
    inputs: [{ kind: "file", mimeTypes: ["image/jpeg", "image/png"], maxFiles: 20, maxSizeBytes: 50 * MB }],
    outputs: [{ kind: "file", mimeTypes: ["image/jpeg", "image/png", "application/zip"], extensions: [".jpg", ".png", ".zip"] }],
    supportsBatch: true,
    supportsWorkspace: false,
    supportsRecipe: false,
    supportsOffline: true,
    handoff: { canSend: true, canReceive: true, kinds: ["file"] },
    suggestedNextTools: ["image-compressor", "image-converter"],
    privacy: "local-only",
    privacyNote: "直接改寫位元組移除 metadata，照片不會離開瀏覽器。",
  },
  {
    slug: "chinese-converter",
    name: "繁簡轉換",
    description: "OpenCC 繁簡互轉，支援台灣用詞（軟件→軟體），本機處理不上傳。",
    category: "text",
    symbol: "繁",
    accent: "blue",
    status: "active",
    processing: "local",
    engines: ["native"],
    inputs: [{ kind: "text" }],
    outputs: [
      { kind: "text" },
      { kind: "file", mimeTypes: ["text/plain"], extensions: [".txt"] },
    ],
    supportsBatch: false,
    supportsWorkspace: true,
    supportsRecipe: false,
    supportsOffline: true,
    handoff: { canSend: true, canReceive: true, kinds: ["text"] },
    suggestedNextTools: ["text-cleaner", "text-compare", "markdown-editor"],
    privacy: "local-only",
    privacyNote: "OpenCC 字典隨網站一起載入，轉換在本機完成。",
  },
  {
    slug: "favicon-generator",
    name: "Favicon 產生器",
    description: "用文字、emoji 或圖片產生整套 favicon，附 HTML 與 manifest 片段。",
    category: "image",
    symbol: "◆",
    accent: "sora",
    status: "active",
    processing: "local",
    engines: ["native"],
    inputs: [
      { kind: "text" },
      { kind: "file", mimeTypes: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"], maxFiles: 1, maxSizeBytes: 5 * MB },
    ],
    outputs: [{ kind: "file", mimeTypes: ["application/zip"], extensions: [".zip"] }],
    supportsBatch: false,
    supportsWorkspace: false,
    supportsRecipe: false,
    supportsOffline: true,
    handoff: { canSend: false, canReceive: false, kinds: [] },
    suggestedNextTools: ["image-compressor"],
    privacy: "local-only",
    privacyNote: "圖示在 Canvas 本機繪製並打包成 ZIP，來源圖片不會上傳。",
  },
  {
    slug: "image-crop",
    name: "圖片裁切",
    description: "自由框選或固定比例裁切圖片，輸出 PNG、JPG，圖片不上傳。",
    category: "image",
    symbol: "◫",
    accent: "toki",
    status: "active",
    processing: "local",
    engines: ["native"],
    inputs: [{ kind: "file", mimeTypes: ["image/jpeg", "image/png", "image/webp"], maxFiles: 1, maxSizeBytes: 25 * MB }],
    outputs: [{ kind: "file", mimeTypes: ["image/png", "image/jpeg"], extensions: [".png", ".jpg"] }],
    supportsBatch: false,
    supportsWorkspace: false,
    supportsRecipe: false,
    supportsOffline: true,
    handoff: { canSend: true, canReceive: true, kinds: ["file"] },
    suggestedNextTools: ["image-compressor", "image-converter", "exif-cleaner"],
    privacy: "local-only",
    privacyNote: "裁切用 Canvas 在本機完成，圖片不會離開瀏覽器。",
  },
  {
    slug: "text-compare",
    name: "文字比較",
    description: "比較兩段文字差異：逐行、逐詞、逐字，標示新增刪除與修改，本機比較。",
    category: "text",
    symbol: "≒",
    accent: "fuji",
    status: "active",
    processing: "local",
    engines: ["native"],
    inputs: [{ kind: "text" }],
    outputs: [{ kind: "text" }],
    supportsBatch: false,
    supportsWorkspace: false,
    supportsRecipe: false,
    supportsOffline: true,
    handoff: { canSend: false, canReceive: true, kinds: ["text"] },
    suggestedNextTools: ["text-cleaner"],
    privacy: "local-only",
    privacyNote: "兩段文字都只在瀏覽器裡比對。",
  },
  {
    slug: "markdown-editor",
    name: "Markdown 編輯器",
    description: "即時預覽、支援 GFM 表格與程式碼，草稿自動儲存，可下載 .md 或複製 HTML。",
    category: "text",
    symbol: "✎",
    accent: "sora",
    status: "active",
    processing: "local",
    engines: ["native"],
    inputs: [{ kind: "text" }],
    outputs: [
      { kind: "text", mimeTypes: ["text/markdown", "text/html"] },
      { kind: "file", mimeTypes: ["text/markdown"], extensions: [".md"] },
    ],
    supportsBatch: false,
    supportsWorkspace: true,
    supportsRecipe: false,
    supportsOffline: true,
    handoff: { canSend: true, canReceive: true, kinds: ["text"] },
    suggestedNextTools: ["text-cleaner", "chinese-converter"],
    privacy: "local-only",
    privacyNote: "草稿自動存在瀏覽器 localStorage，不會同步到任何伺服器。",
  },
  {
    slug: "csv-editor",
    name: "CSV 編輯器",
    description: "貼上或開啟 CSV／TSV 直接編輯、排序、增刪欄列，匯出 CSV 或 JSON。",
    category: "utility",
    symbol: "☰",
    accent: "mint",
    status: "active",
    processing: "local",
    engines: ["native"],
    inputs: [
      { kind: "file", mimeTypes: ["text/csv", "text/tab-separated-values"], extensions: [".csv", ".tsv"], maxFiles: 1, maxSizeBytes: 10 * MB },
      { kind: "text" },
    ],
    outputs: [{ kind: "file", mimeTypes: ["text/csv", "application/json"], extensions: [".csv", ".json"] }],
    supportsBatch: false,
    supportsWorkspace: false,
    supportsRecipe: false,
    supportsOffline: true,
    handoff: { canSend: false, canReceive: false, kinds: [] },
    suggestedNextTools: ["gantt"],
    privacy: "local-only",
    privacyNote: "表格內容只在瀏覽器裡編輯與匯出。",
  },
  {
    slug: "image-converter",
    name: "圖片格式轉換",
    description: "批次把 JPG、PNG、GIF、BMP、SVG 轉成 WebP、PNG、JPG，可調品質。",
    category: "image",
    symbol: "⇋",
    accent: "coral",
    status: "active",
    processing: "local",
    engines: ["native"],
    inputs: [{
      kind: "file",
      mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp", "image/svg+xml"],
      maxFiles: 20,
      maxSizeBytes: 25 * MB,
    }],
    outputs: [{ kind: "file", mimeTypes: ["image/webp", "image/png", "image/jpeg", "application/zip"], extensions: [".webp", ".png", ".jpg", ".zip"] }],
    supportsBatch: true,
    supportsWorkspace: false,
    supportsRecipe: false,
    supportsOffline: true,
    handoff: { canSend: true, canReceive: true, kinds: ["file"] },
    suggestedNextTools: ["image-compressor", "exif-cleaner", "image-crop"],
    privacy: "local-only",
    privacyNote: "轉檔用 Canvas 在本機完成，圖片不會上傳。",
  },
  {
    slug: "audio-trimmer",
    name: "音訊剪輯",
    description: "看著波形剪輯音檔或合併多段音訊，輸出 PCM WAV，MP3、WAV 等格式不上傳。",
    category: "utility",
    symbol: "♪",
    accent: "matsuba",
    status: "active",
    processing: "local",
    engines: ["native"],
    inputs: [{
      kind: "file",
      mimeTypes: ["audio/mpeg", "audio/wav", "audio/mp4", "audio/ogg"],
      extensions: [".mp3", ".wav", ".m4a", ".ogg"],
      maxFiles: 8,
      maxSizeBytes: 30 * MB,
    }],
    outputs: [{ kind: "file", mimeTypes: ["audio/wav"], extensions: [".wav"] }],
    supportsBatch: true,
    supportsWorkspace: false,
    supportsRecipe: false,
    supportsOffline: true,
    handoff: { canSend: false, canReceive: false, kinds: [] },
    suggestedNextTools: [],
    privacy: "local-only",
    privacyNote: "解碼與輸出都用 Web Audio API 在本機完成，音檔不會上傳。",
  },
  {
    slug: "calendar",
    name: "月曆",
    description: "快速檢視日期的月曆：標示今天、週末與國定假日（含農曆節日），可跳到任何月份。",
    category: "utility",
    symbol: "⊞",
    accent: "sumi",
    status: "active",
    processing: "local",
    engines: ["native"],
    inputs: [{ kind: "structured-data" }],
    outputs: [],
    supportsBatch: false,
    supportsWorkspace: false,
    supportsRecipe: false,
    supportsOffline: true,
    handoff: { canSend: false, canReceive: false, kinds: [] },
    suggestedNextTools: ["countdown-timer"],
    privacy: "local-only",
    privacyNote: "月曆與假日資料都內建在網站裡，不會連線查詢，也不會記錄你看過哪些日期。",
  },
  {
    slug: "event-lottery",
    name: "活動抽獎控制台",
    description: "尾牙、公司活動用的正式抽獎控制台：多名單群組、多獎項、後台控制搭配獨立投影舞台，得獎紀錄可匯出備份。",
    category: "random",
    symbol: "❋",
    accent: "matsuba",
    status: "beta",
    processing: "local",
    engines: ["native"],
    inputs: [
      { kind: "structured-data" },
      { kind: "file", mimeTypes: ["text/csv"], extensions: [".csv"], maxFiles: 1 },
      { kind: "file", mimeTypes: ["application/json"], extensions: [".json"], maxFiles: 1 },
      { kind: "file", mimeTypes: ["image/png", "image/jpeg", "image/webp"], maxFiles: 1, maxSizeBytes: 15 * MB },
    ],
    outputs: [
      { kind: "file", mimeTypes: ["text/csv"], extensions: [".csv"] },
      { kind: "file", mimeTypes: ["application/json"], extensions: [".json"] },
    ],
    supportsBatch: false,
    supportsWorkspace: false,
    supportsRecipe: false,
    supportsOffline: true,
    handoff: { canSend: false, canReceive: false, kinds: [] },
    suggestedNextTools: ["lottery", "random-groups"],
    privacy: "local-only",
    privacyNote: "未啟用手機遙控時，活動設定、名單、獎項與得獎紀錄只留在這台裝置的 localStorage；若主動啟用手機遙控，只會傳送短期配對 session 與不含個資的狀態摘要。",
  },
  {
    slug: "subtitle-editor",
    name: "字幕編輯器",
    description: "SRT／VTT 互轉、時間碼整體偏移與倍率校正，逐條編輯後輸出字幕或逐字稿。",
    category: "text",
    symbol: "幕",
    accent: "toki",
    status: "active",
    processing: "local",
    engines: ["native"],
    inputs: [
      { kind: "text" },
      { kind: "file", mimeTypes: ["text/vtt", "application/x-subrip"], extensions: [".srt", ".vtt"], maxFiles: 1, maxSizeBytes: 5 * MB },
    ],
    outputs: [
      { kind: "text" },
      { kind: "file", mimeTypes: ["application/x-subrip", "text/vtt", "text/plain"], extensions: [".srt", ".vtt", ".txt"] },
    ],
    supportsBatch: false,
    supportsWorkspace: true,
    supportsRecipe: false,
    supportsOffline: true,
    handoff: { canSend: true, canReceive: true, kinds: ["text"] },
    suggestedNextTools: ["text-cleaner", "chinese-converter", "text-compare"],
    privacy: "local-only",
    privacyNote: "字幕檔在瀏覽器裡解析、調整與輸出，內容不會上傳。",
  },
];

const BY_SLUG = new Map<string, ToolManifest>(toolManifests.map((manifest) => [manifest.slug, manifest]));

export function getToolManifest(slug: string): ToolManifest | undefined {
  return BY_SLUG.get(slug);
}

/** 給定 MIME 與副檔名，列出宣告吃得下這個檔案的工具。Smart Intake 與接力都靠它。 */
export function toolsAcceptingFile(mimeType: string, extension?: string): ToolManifest[] {
  const mime = mimeType.toLowerCase();
  const ext = extension?.toLowerCase();
  return toolManifests.filter((manifest) =>
    manifest.inputs.some((input) => {
      if (input.kind !== "file") return false;
      if (mime && input.mimeTypes?.includes(mime)) return true;
      return ext !== undefined && ext !== "" && (input.extensions?.includes(ext) ?? false);
    }),
  );
}

/** 吃純文字的工具。 */
export function toolsAcceptingText(): ToolManifest[] {
  return toolManifests.filter((manifest) => manifest.inputs.some((input) => input.kind === "text"));
}

/** 列出真正接上接收 hook 的工具；接力目標與 Smart Intake 都從這裡推導。 */
export function toolsAcceptingHandoff(kind: Extract<ToolCapabilityKind, "file" | "text">): ToolManifest[] {
  return toolManifests.filter((manifest) => manifest.handoff.canReceive && manifest.handoff.kinds.includes(kind));
}

function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/**
 * Runtime 驗證：回傳所有問題的描述，空陣列代表通過。
 *
 * 刻意回傳清單而不是丟第一個錯——一次補完比修一個跑一次快。
 * 由 `tests/tool-manifest.test.mjs` 呼叫，CI 會擋。
 */
export function validateToolManifests(manifests: readonly ToolManifest[] = toolManifests): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const slugs = new Set(manifests.map((manifest) => manifest.slug));

  for (const manifest of manifests) {
    const at = `[${manifest.slug || "(無 slug)"}]`;

    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(manifest.slug)) problems.push(`${at} slug 必須是 kebab-case`);
    if (seen.has(manifest.slug)) problems.push(`${at} slug 重複`);
    seen.add(manifest.slug);

    for (const [field, value] of [["name", manifest.name], ["description", manifest.description], ["symbol", manifest.symbol], ["privacyNote", manifest.privacyNote]] as const) {
      if (typeof value !== "string" || value.trim() === "") problems.push(`${at} ${field} 不可為空`);
    }

    if (!isOneOf(CATEGORIES.map((category) => category.id), manifest.category)) problems.push(`${at} category「${manifest.category}」不在 CATEGORIES`);
    if (!isOneOf(ACCENTS, manifest.accent)) problems.push(`${at} accent「${manifest.accent}」不在 ACCENTS`);
    if (!isOneOf(TOOL_STATUSES, manifest.status)) problems.push(`${at} status「${manifest.status}」不合法`);
    if (!isOneOf(PROCESSING_MODES, manifest.processing)) problems.push(`${at} processing「${manifest.processing}」不合法`);
    if (!isOneOf(PRIVACY_LEVELS, manifest.privacy)) problems.push(`${at} privacy「${manifest.privacy}」不合法`);

    if (manifest.engines.length === 0) problems.push(`${at} engines 不可為空`);
    for (const engine of manifest.engines) {
      if (!isOneOf(TOOL_ENGINES, engine)) problems.push(`${at} engine「${engine}」不合法`);
    }

    // processing 與 engines 必須互相印證：宣告「完全本機」卻列了 remote-api，
    // 或宣告會連線卻沒有任何遠端引擎，兩者都代表隱私標示有問題。
    const hasRemoteEngine = manifest.engines.includes("remote-api");
    if (manifest.processing === "local" && hasRemoteEngine) problems.push(`${at} processing 是 local 卻宣告了 remote-api engine`);
    if (manifest.processing !== "local" && !hasRemoteEngine) problems.push(`${at} processing 是 ${manifest.processing} 卻沒有 remote-api engine`);

    // 隱私標示是使用者唯一的判斷依據，不能跟運算位置對不起來。
    if (manifest.processing === "local" && manifest.privacy === "third-party") problems.push(`${at} processing 是 local 卻標成會送往第三方`);
    if (manifest.processing === "remote" && manifest.privacy !== "third-party") problems.push(`${at} processing 是 remote，privacy 必須是 third-party`);
    if (manifest.processing === "hybrid" && manifest.privacy !== "conditional") problems.push(`${at} processing 是 hybrid，privacy 必須是 conditional`);

    // 離線可用代表「完全不需要網路」，首次要下載模型／呼叫 API 的都不算。
    if (manifest.supportsOffline && manifest.processing !== "local") problems.push(`${at} supportsOffline 只有 processing 為 local 時才成立`);
    if (manifest.supportsOffline && manifest.privacy !== "local-only") problems.push(`${at} supportsOffline 與 privacy「${manifest.privacy}」矛盾`);

    if (!manifest.handoff || typeof manifest.handoff.canSend !== "boolean" || typeof manifest.handoff.canReceive !== "boolean") {
      problems.push(`${at} handoff 必須宣告 canSend 與 canReceive`);
    } else {
      const handoffKinds = new Set<string>();
      for (const kind of manifest.handoff.kinds) {
        if (!isOneOf(CAPABILITY_KINDS, kind)) problems.push(`${at} handoff kind「${kind}」不合法`);
        if (handoffKinds.has(kind)) problems.push(`${at} handoff kinds 有重複的「${kind}」`);
        handoffKinds.add(kind);
      }
      if (!manifest.handoff.canSend && !manifest.handoff.canReceive && manifest.handoff.kinds.length > 0) {
        problems.push(`${at} handoff 沒有收送能力卻宣告了 kinds`);
      }
      if ((manifest.handoff.canSend || manifest.handoff.canReceive) && manifest.handoff.kinds.length === 0) {
        problems.push(`${at} handoff 有收送能力卻沒有宣告 kinds`);
      }
    }

    for (const [label, capabilities] of [["inputs", manifest.inputs], ["outputs", manifest.outputs]] as const) {
      for (const capability of capabilities) {
        if (!isOneOf(CAPABILITY_KINDS, capability.kind)) problems.push(`${at} ${label} 的 kind「${capability.kind}」不合法`);
        if (capability.kind === "file" && !capability.mimeTypes?.length && !capability.extensions?.length) {
          problems.push(`${at} ${label} 的 file 能力必須至少宣告 mimeTypes 或 extensions`);
        }
        for (const extension of capability.extensions ?? []) {
          if (!extension.startsWith(".")) problems.push(`${at} ${label} 的副檔名「${extension}」必須以點開頭`);
        }
      }
    }

    for (const input of manifest.inputs) {
      if (input.maxFiles !== undefined && input.maxFiles < 1) problems.push(`${at} inputs 的 maxFiles 必須 ≥ 1`);
      if (input.maxSizeBytes !== undefined && input.maxSizeBytes <= 0) problems.push(`${at} inputs 的 maxSizeBytes 必須 > 0`);
      // maxFiles 省略依欄位文件語意代表「沒有明確上限」；file 能力省略它卻同時
      // 宣告 supportsBatch 為 false，等於自稱「檔案數量沒上限」又「不支援批
      // 次」，是自相矛盾的宣告。下面 acceptsMultiple 的 `?? 1` 只看得出
      // maxFiles > 1 的情況，抓不到「省略」這種本身就有問題的宣告，這裡另外
      // 補上。
      if (input.kind === "file" && input.maxFiles === undefined && !manifest.supportsBatch) {
        problems.push(`${at} file 能力省略 maxFiles（依文件語意代表沒有上限），但 supportsBatch 是 false，請明確標上 maxFiles 或改成 supportsBatch: true`);
      }
    }

    const acceptsMultiple = manifest.inputs.some((input) => (input.maxFiles ?? 1) > 1);
    if (manifest.supportsBatch && !acceptsMultiple) problems.push(`${at} supportsBatch 為 true，但沒有任何 input 的 maxFiles > 1`);
    if (!manifest.supportsBatch && acceptsMultiple) problems.push(`${at} 有 input 的 maxFiles > 1，supportsBatch 卻是 false`);

    const suggested = new Set<string>();
    for (const slug of manifest.suggestedNextTools) {
      if (slug === manifest.slug) problems.push(`${at} suggestedNextTools 不可指向自己`);
      if (suggested.has(slug)) problems.push(`${at} suggestedNextTools 有重複的「${slug}」`);
      suggested.add(slug);
      if (!slugs.has(slug)) problems.push(`${at} suggestedNextTools 的「${slug}」不是已註冊的工具`);
    }
  }

  return problems;
}
