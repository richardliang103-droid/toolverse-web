"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IMAGE_TOOL_SLUGS, putHandoff, type ImageToolSlug } from "@/lib/handoff";
import { tools } from "@/lib/tools";

const NAMES = new Map(tools.map((tool) => [tool.slug, tool.name] as const));

type SendToToolsProps = {
  /** 來源工具 slug；會從清單排除自己。 */
  from: ImageToolSlug;
  /**
   * 產生要遞出去的檔案。點下去才呼叫——像裁切這種結果取決於當下框選的工具，
   * 不必為了讓按鈕能用就每次拖曳都重算一遍。回傳 null 代表產生失敗。
   */
  getFile: () => Promise<File | null> | File | null;
};

/**
 * 「送到 →」按鈕列：把結果直接交給下一個工具，不用下載再重新上傳。
 *
 * 先備好檔案再用 router.push 做 client-side 導覽——不重載頁面，
 * 所以模組層的交接區在目的地讀得到。
 */
export function SendToTools({ from, getFile }: SendToToolsProps) {
  const router = useRouter();
  const [busySlug, setBusySlug] = useState("");
  const targets = IMAGE_TOOL_SLUGS.filter((slug) => slug !== from);

  async function send(slug: string) {
    if (busySlug) return;
    setBusySlug(slug);
    try {
      const file = await getFile();
      if (!file) return;
      putHandoff(file, from);
      router.push(`/tools/${slug}`);
    } finally {
      setBusySlug("");
    }
  }

  return (
    <div className="send-to-tools">
      <span className="send-to-label">送到</span>
      {targets.map((slug) => (
        <button
          key={slug}
          className="button button-small button-secondary"
          type="button"
          disabled={busySlug !== ""}
          onClick={() => { void send(slug); }}
        >
          {NAMES.get(slug) ?? slug}
        </button>
      ))}
    </div>
  );
}
