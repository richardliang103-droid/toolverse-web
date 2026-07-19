"use client";

// 全站深淺色切換。目前主題存在 <html data-theme>（由 layout 的 inline script
// 在繪製前設定），這裡只負責翻轉並記住選擇；圖示用 CSS 依 data-theme 切換，
// 因此 SSR 與 client 首次渲染輸出一致，沒有 hydration 閃爍。
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("toolverse:theme", next); } catch { /* 私密模式寫不進去就只影響本頁 */ }
  }

  return (
    <button className="theme-toggle" type="button" onClick={toggle} aria-label="切換深淺色主題" title="切換深淺色">
      <span className="theme-toggle-to-dark" aria-hidden="true">🌙</span>
      <span className="theme-toggle-to-light" aria-hidden="true">☀️</span>
    </button>
  );
}
