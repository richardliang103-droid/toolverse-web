import assert from "node:assert/strict";
import test from "node:test";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../lib/supabase-browser.ts";

// 手機遙控是 optional enhancement：Vercel 沒設定 NEXT_PUBLIC_SUPABASE_URL／
// NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 時，整個模組必須安全地回傳「沒有設定」，
// 不能在 import 階段就 throw，否則會拖垮完全不需要手機遙控的活動抽獎本機功能。
test("Supabase 環境變數缺失時：isSupabaseConfigured 回傳 false，getSupabaseBrowserClient 回傳 null（不拋例外）", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  try {
    assert.equal(isSupabaseConfigured(), false);
    assert.equal(getSupabaseBrowserClient(), null);
  } finally {
    if (originalUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey !== undefined) process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;
  }
});
