import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_RECENT_TOOLS,
  orderToolsForPersonal,
  recordRecentTool,
  sanitizePersonalToolsState,
  setRecentTracking,
  toggleFavoriteTool,
} from "../lib/personal-tools.ts";

const slugs = ["a", "b", "c", "d", "e", "f", "g"];

test("個人工具設定：損壞資料、重複與不存在的 slug 都會被清理", () => {
  assert.deepEqual(sanitizePersonalToolsState(null, slugs), {
    favoriteSlugs: [],
    recentSlugs: [],
    trackRecent: true,
  });
  assert.deepEqual(sanitizePersonalToolsState({
    favoriteSlugs: ["b", "b", "missing", 3, "a"],
    recentSlugs: ["g", "f", "e", "d", "c", "b", "a", "g"],
    trackRecent: true,
  }, slugs), {
    favoriteSlugs: ["b", "a"],
    recentSlugs: ["g", "f", "e", "d", "c", "b"],
    trackRecent: true,
  });
  assert.equal(MAX_RECENT_TOOLS, 6);
});

test("收藏：可加入、取消，且拒絕 manifest 外的 slug", () => {
  const initial = sanitizePersonalToolsState({}, slugs);
  const added = toggleFavoriteTool(initial, "b", slugs);
  assert.deepEqual(added.favoriteSlugs, ["b"]);
  assert.deepEqual(toggleFavoriteTool(added, "b", slugs).favoriteSlugs, []);
  assert.equal(toggleFavoriteTool(initial, "missing", slugs), initial);
});

test("最近使用：只記 slug、去重移到最前面，最多六個", () => {
  let state = sanitizePersonalToolsState({}, slugs);
  for (const slug of slugs) state = recordRecentTool(state, slug, slugs);
  assert.deepEqual(state.recentSlugs, ["g", "f", "e", "d", "c", "b"]);
  state = recordRecentTool(state, "d", slugs);
  assert.deepEqual(state.recentSlugs, ["d", "g", "f", "e", "c", "b"]);
  assert.equal(recordRecentTool(state, "missing", slugs), state);
});

test("隱私開關：停用後清除紀錄，也不再加入新項目", () => {
  const state = sanitizePersonalToolsState({ recentSlugs: ["a", "b"] }, slugs);
  const disabled = setRecentTracking(state, false);
  assert.deepEqual(disabled.recentSlugs, []);
  assert.equal(disabled.trackRecent, false);
  assert.equal(recordRecentTool(disabled, "c", slugs), disabled);
  assert.equal(setRecentTracking(disabled, true).trackRecent, true);
});

test("命令面板排序：收藏優先、最近其次，其餘維持原順序", () => {
  const items = slugs.slice(0, 4).map((slug) => ({ slug }));
  assert.deepEqual(
    orderToolsForPersonal(items, ["c", "a"], ["b", "c"]).map((item) => item.slug),
    ["c", "a", "b", "d"],
  );
});
