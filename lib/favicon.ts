export type FaviconSize = { size: number; label: string; filename: string };

// 常用的一整套 favicon 尺寸：瀏覽器分頁、iOS 主畫面、PWA 圖示。
export const FAVICON_SIZES: FaviconSize[] = [
  { size: 16, label: "分頁 16", filename: "favicon-16.png" },
  { size: 32, label: "分頁 32", filename: "favicon-32.png" },
  { size: 48, label: "分頁 48", filename: "favicon-48.png" },
  { size: 180, label: "iOS 180", filename: "apple-touch-icon.png" },
  { size: 192, label: "Android 192", filename: "icon-192.png" },
  { size: 512, label: "PWA 512", filename: "icon-512.png" },
];

/** 從文字取最多兩個字作為圖示字樣（中文取一字、英文取首字母，可跨兩個單字）。 */
export function faviconInitials(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const words = trimmed.split(/\s+/);
  if (/[A-Za-z0-9]/.test(trimmed) && words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  const chars = [...trimmed];
  // 中日韓字元一個就夠；其餘取前兩字。
  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(chars[0])) return chars[0];
  return chars.slice(0, 2).join("").toUpperCase();
}

/** 產生可貼進 <head> 的引用片段。 */
export function faviconHtmlSnippet(): string {
  return [
    '<link rel="icon" href="/favicon-32.png" sizes="32x32">',
    '<link rel="icon" href="/favicon-16.png" sizes="16x16">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    '<link rel="manifest" href="/site.webmanifest">',
  ].join("\n");
}

/** 產生對應的 web manifest 片段。 */
export function faviconManifestSnippet(name = "My Site"): string {
  return JSON.stringify(
    {
      name,
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ],
    },
    null,
    2,
  );
}
