"use client";

import { useEffect, useRef } from "react";
import { takeHandoff } from "@/lib/handoff";
import { tools } from "@/lib/tools";

const NAMES = new Map<string, string>(tools.map((tool) => [tool.slug, tool.name]));

function toolName(slug: string) {
  return NAMES.get(slug) ?? slug;
}

/**
 * 接收端共用邏輯：掛載時消費一次交接內容，交給工具自己原本的載入路徑。
 *
 * takeHandoff() 取完即清，所以用上一頁／下一頁回來不會重複套用；
 * ref 再擋一層，讓 StrictMode 的重複掛載也只跑一次。
 */
function useHandoffOfKind(kind: "file" | "text", apply: (handoff: { file?: File; text?: string; fromName: string }) => void) {
  const consumedRef = useRef(false);

  useEffect(() => {
    if (consumedRef.current) return;
    consumedRef.current = true;
    const handoff = takeHandoff(kind);
    if (!handoff) return;
    const fromName = toolName(handoff.fromSlug);
    if (handoff.kind === "file") apply({ file: handoff.file, fromName });
    else apply({ text: handoff.text, fromName });
    // 交接只在掛載時消費一次。apply 每次 render 都是新的函式參考，
    // 放進 deps 會讓這個 effect 反覆執行。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** 圖片類工具的接收端。 */
export function useHandoff(onReceive: (file: File, fromName: string) => void) {
  useHandoffOfKind("file", ({ file, fromName }) => { if (file) onReceive(file, fromName); });
}

/** 文字類工具的接收端。 */
export function useTextHandoff(onReceive: (text: string, fromName: string) => void) {
  useHandoffOfKind("text", ({ text, fromName }) => { if (text !== undefined) onReceive(text, fromName); });
}
