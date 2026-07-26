export const MAX_RECENT_TOOLS = 6;

export interface PersonalToolsState {
  favoriteSlugs: string[];
  recentSlugs: string[];
  trackRecent: boolean;
}

export const DEFAULT_PERSONAL_TOOLS_STATE: PersonalToolsState = {
  favoriteSlugs: [],
  recentSlugs: [],
  trackRecent: true,
};

function uniqueValidSlugs(value: unknown, validSlugs: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  const valid = new Set(validSlugs);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const slug of value) {
    if (typeof slug !== "string" || !valid.has(slug) || seen.has(slug)) continue;
    seen.add(slug);
    result.push(slug);
  }
  return result;
}

/** localStorage 可能被手動修改或留下舊資料；只接受 manifest 仍存在的工具 slug。 */
export function sanitizePersonalToolsState(value: unknown, validSlugs: readonly string[]): PersonalToolsState {
  const data = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const trackRecent = data.trackRecent !== false;
  return {
    favoriteSlugs: uniqueValidSlugs(data.favoriteSlugs, validSlugs),
    recentSlugs: trackRecent ? uniqueValidSlugs(data.recentSlugs, validSlugs).slice(0, MAX_RECENT_TOOLS) : [],
    trackRecent,
  };
}

export function toggleFavoriteTool(
  state: PersonalToolsState,
  slug: string,
  validSlugs: readonly string[],
): PersonalToolsState {
  if (!validSlugs.includes(slug)) return state;
  const exists = state.favoriteSlugs.includes(slug);
  return {
    ...state,
    favoriteSlugs: exists
      ? state.favoriteSlugs.filter((candidate) => candidate !== slug)
      : [slug, ...state.favoriteSlugs],
  };
}

/** 最近使用只記 slug，同一工具移到最前面，最多保留六個。 */
export function recordRecentTool(
  state: PersonalToolsState,
  slug: string,
  validSlugs: readonly string[],
): PersonalToolsState {
  if (!state.trackRecent || !validSlugs.includes(slug)) return state;
  return {
    ...state,
    recentSlugs: [slug, ...state.recentSlugs.filter((candidate) => candidate !== slug)].slice(0, MAX_RECENT_TOOLS),
  };
}

/** 關閉記錄時一併清掉既有紀錄；收藏不受影響。 */
export function setRecentTracking(state: PersonalToolsState, enabled: boolean): PersonalToolsState {
  if (state.trackRecent === enabled && (enabled || state.recentSlugs.length === 0)) return state;
  return { ...state, trackRecent: enabled, recentSlugs: enabled ? state.recentSlugs : [] };
}

/** 匯入採合併；任一邊停用最近使用，就保留較嚴格的隱私設定。 */
export function mergePersonalToolsState(
  current: PersonalToolsState,
  incoming: PersonalToolsState,
  validSlugs: readonly string[],
): PersonalToolsState {
  const left = sanitizePersonalToolsState(current, validSlugs);
  const right = sanitizePersonalToolsState(incoming, validSlugs);
  const unique = (values: readonly string[]) => [...new Set(values)];
  const trackRecent = left.trackRecent && right.trackRecent;
  return {
    favoriteSlugs: unique([...left.favoriteSlugs, ...right.favoriteSlugs]),
    recentSlugs: trackRecent
      ? unique([...left.recentSlugs, ...right.recentSlugs]).slice(0, MAX_RECENT_TOOLS)
      : [],
    trackRecent,
  };
}

/** ⌘K 把收藏放前面，其次是最近使用，其餘維持 manifest 原始順序。 */
export function orderToolsForPersonal<T extends { slug: string }>(
  items: readonly T[],
  favoriteSlugs: readonly string[],
  recentSlugs: readonly string[],
): T[] {
  const bySlug = new Map(items.map((item) => [item.slug, item]));
  const used = new Set<string>();
  const ordered: T[] = [];
  for (const slug of [...favoriteSlugs, ...recentSlugs]) {
    const item = bySlug.get(slug);
    if (!item || used.has(slug)) continue;
    used.add(slug);
    ordered.push(item);
  }
  for (const item of items) {
    if (used.has(item.slug)) continue;
    used.add(item.slug);
    ordered.push(item);
  }
  return ordered;
}
