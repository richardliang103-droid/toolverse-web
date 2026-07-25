/**
 * 工具卡片視圖 —— 從 `lib/tool-manifest.ts` 推導，不自己維護第二份清單。
 *
 * 首頁、⌘K 命令面板、sitemap 與工具頁的 JSON-LD 都讀這裡；要新增或修改工具
 * 一律改 manifest。這個模組只負責把 manifest 收斂成畫卡片需要的欄位，並保留
 * 既有的 `status`（"READY"／"BETA"）字面值，讓舊的呼叫端不用一起改。
 */
// 相對匯入一律寫出 `.ts`：這些 lib 模組同時要被 `node --test --experimental-strip-types`
// 直接載入，而 Node 的 ESM 解析器不會替你補副檔名（bundler 會，Node 不會）。
import { CATEGORIES, toolManifests, type CategoryId, type ToolManifest } from "./tool-manifest.ts";

export { ACCENTS, CATEGORIES, PRIVACY_LABELS, getToolManifest, toolManifests } from "./tool-manifest.ts";
export type { AccentId, CategoryId, ToolManifest } from "./tool-manifest.ts";

/** 卡片標籤。manifest 用 active／beta／planned，這裡沿用原本的大寫字面值。 */
export type ToolBadge = "READY" | "BETA" | "PLANNED";

export interface Tool {
  slug: string;
  name: string;
  description: string;
  symbol: string;
  accent: string;
  status: ToolBadge;
  category: CategoryId;
}

const BADGES: Record<ToolManifest["status"], ToolBadge> = {
  active: "READY",
  beta: "BETA",
  planned: "PLANNED",
};

function toCard(manifest: ToolManifest): Tool {
  return {
    slug: manifest.slug,
    name: manifest.name,
    description: manifest.description,
    symbol: manifest.symbol,
    accent: manifest.accent,
    status: BADGES[manifest.status],
    category: manifest.category,
  };
}

/** 首頁順序＝manifest 順序。 */
export const tools: readonly Tool[] = toolManifests.map(toCard);

const CATEGORY_LABELS = new Map<string, string>(CATEGORIES.map((category) => [category.id, category.label]));

function categoryLabel(id: CategoryId): string {
  return CATEGORY_LABELS.get(id) ?? "";
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
