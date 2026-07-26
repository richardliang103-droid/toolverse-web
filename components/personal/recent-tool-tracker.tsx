"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { recordRecentToolVisit } from "@/components/personal/use-personal-tools";
import { getToolManifest } from "@/lib/tools";

/** 全站只記錄工具 slug；URL 參數、檔名與內容都不會進入最近使用。 */
export function RecentToolTracker() {
  const pathname = usePathname();

  useEffect(() => {
    const match = pathname.match(/^\/tools\/([^/]+)\/?$/);
    const slug = match?.[1];
    if (slug && getToolManifest(slug)) recordRecentToolVisit(slug);
  }, [pathname]);

  return null;
}
