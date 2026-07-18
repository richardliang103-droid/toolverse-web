import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { ServiceWorkerRegister } from "@/components/sw-register";
import "./globals.css";

export const viewport: Viewport = { themeColor: "#f5f1e8" };

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const image = new URL("/og.png", base).toString();

  return {
    metadataBase: base,
    title: { default: "ToolVerse｜網頁工具", template: "%s｜ToolVerse" },
    description: "免登入的網頁工具箱：圖表、抽獎與分組、圖片與 PDF 處理、計時與文字工具。",
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, statusBarStyle: "default", title: "ToolVerse" },
    icons: {
      icon: "/favicon.png",
      shortcut: "/favicon.png",
      apple: "/apple-touch-icon.png",
    },
    // 不寫死 openGraph/twitter 的 title 與 description：留空時 Next 會回退到各頁自己的
    // title（含「%s｜ToolVerse」模板）與 description，讓每個工具分享時顯示自己的名稱。
    openGraph: { type: "website", locale: "zh_TW", siteName: "ToolVerse", images: [{ url: image, width: 1200, height: 630, alt: "ToolVerse 工具目錄" }] },
    twitter: { card: "summary_large_image", images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body><ServiceWorkerRegister />{children}</body></html>;
}
