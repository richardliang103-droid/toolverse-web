"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * 手機遙控是 optional enhancement，不是活動抽獎的必要依賴。這個模組刻意不在
 * import 階段讀取環境變數或建立 client——Vercel 沒設定 Supabase 環境變數時，
 * 專案仍必須能正常 build 與執行，本機抽獎（localStorage＋BroadcastChannel）
 * 完全不受影響。
 *
 * 瀏覽器只能拿到 anon/publishable key（NEXT_PUBLIC_ 開頭），任何 secret key
 * 或 service role key 都不可以出現在這裡或任何前端程式碼。
 */

let cachedClient: SupabaseClient | null | undefined;

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) && Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

/** 沒設定環境變數時回傳 null，呼叫端一律要處理這個情況並顯示「尚未設定手機遙控服務」，不得拋出例外。 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (cachedClient !== undefined) return cachedClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    cachedClient = null;
    return cachedClient;
  }
  cachedClient = createClient(url, publishableKey);
  return cachedClient;
}
