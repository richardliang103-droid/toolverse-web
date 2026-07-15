import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const image = new URL("/og.png", base).toString();

  return {
    metadataBase: base,
    title: { default: "ToolVerse｜俐落好用的網頁工具", template: "%s｜ToolVerse" },
    description: "免安裝、免登入的實用網頁工具：公平抽獎、圖片去背，以及更多即將加入的日常工具。",
    openGraph: { title: "ToolVerse", description: "把麻煩的小事，變成俐落的一步。", type: "website", locale: "zh_TW", images: [{ url: image, width: 1200, height: 630, alt: "ToolVerse" }] },
    twitter: { card: "summary_large_image", title: "ToolVerse", description: "把麻煩的小事，變成俐落的一步。", images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
