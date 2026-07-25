"use client";

import { useEffect, useRef } from "react";
import { takeHandoff } from "@/lib/handoff";
import { tools } from "@/lib/tools";

const NAMES = new Map<string, string>(tools.map((tool) => [tool.slug, tool.name]));

/**
 * 接收端：掛載時消費一次交接檔，交給工具自己原本的載入函式。
 *
 * takeHandoff() 取完即清，所以用上一頁／下一頁回來不會重複套用同一個檔案；
 * ref 再擋一層，讓 StrictMode 的重複掛載也只跑一次。
 */
export function useHandoff(onReceive: (file: File, fromName: string) => void) {
  const consumedRef = useRef(false);

  useEffect(() => {
    if (consumedRef.current) return;
    consumedRef.current = true;
    const handoff = takeHandoff();
    if (!handoff) return;
    onReceive(handoff.file, NAMES.get(handoff.fromSlug) ?? handoff.fromSlug);
    // 交接只在掛載時消費一次。onReceive 每次 render 都是新的函式參考，
    // 放進 deps 會讓這個 effect 反覆執行。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
