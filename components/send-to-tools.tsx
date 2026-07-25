"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { putFileHandoff, putTextHandoff } from "@/lib/handoff";
import { tools } from "@/lib/tools";

const NAMES = new Map<string, string>(tools.map((tool) => [tool.slug, tool.name]));

type SendToToolsProps = {
  /** 來源工具 slug；會從清單排除自己。 */
  from: string;
  /** 可接收的目標工具。 */
  targets: readonly string[];
  /**
   * 產生要遞出去的內容。點下去才呼叫——像裁切這種結果取決於當下框選的工具，
   * 不必為了讓按鈕能用就每次拖曳都重算一遍。回傳 null 代表沒東西可送。
   *
   * getFile 與 getText 只會提供其中一個：圖片鏈用前者、文字鏈用後者。
   */
  getFile?: () => Promise<File | null> | File | null;
  getText?: () => string | null;
};

/**
 * 「送到 →」按鈕列：把結果直接交給下一個工具，不用下載再重新上傳、
 * 也不用複製貼上。
 *
 * 先備好內容再用 router.push 做 client-side 導覽——不重載頁面，
 * 所以模組層的交接區在目的地讀得到。
 */
export function SendToTools({ from, targets, getFile, getText }: SendToToolsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const visible = targets.filter((slug) => slug !== from);

  async function send(slug: string) {
    if (busy) return;
    setBusy(true);
    try {
      if (getText) {
        const text = getText();
        if (!text) return;
        putTextHandoff(text, from);
      } else if (getFile) {
        const file = await getFile();
        if (!file) return;
        putFileHandoff(file, from);
      } else {
        return;
      }
      router.push(`/tools/${slug}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="send-to-tools">
      <span className="send-to-label">送到</span>
      {visible.map((slug) => (
        <button
          key={slug}
          className="button button-small button-secondary"
          type="button"
          disabled={busy}
          onClick={() => { void send(slug); }}
        >
          {NAMES.get(slug) ?? slug}
        </button>
      ))}
    </div>
  );
}
