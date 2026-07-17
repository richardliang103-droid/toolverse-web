import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const image = new URL("/og.png", base).toString();

  return {
    metadataBase: base,
    title: { default: "ToolVerse｜網頁工具", template: "%s｜ToolVerse" },
    description: "流程圖、隨機抽名單與圖片去背。",
    icons: {
      icon: "/favicon.png",
      shortcut: "/favicon.png",
      apple: "/favicon.png",
    },
    openGraph: { title: "ToolVerse", description: "簡單、直接的網頁工具。", type: "website", locale: "zh_TW", images: [{ url: image, width: 1200, height: 630, alt: "ToolVerse 工具目錄" }] },
    twitter: { card: "summary_large_image", title: "ToolVerse", description: "簡單、直接的網頁工具。", images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
