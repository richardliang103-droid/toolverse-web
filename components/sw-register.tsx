"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    // 開發模式不註冊，避免快取蓋掉 HMR。
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => { /* 註冊失敗不影響網站 */ });
  }, []);
  return null;
}
