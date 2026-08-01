"use client";

import { useEffect, useRef, useState } from "react";

/** 兩段式確認：第一次點擊只是「武裝」，幾秒內沒有第二次點擊就自動解除，避免手滑誤刪。 */
export function useArmedConfirm(timeoutMs = 4000) {
  const [armedId, setArmedId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  function confirm(id: string, action: () => void) {
    if (armedId === id) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setArmedId(null);
      action();
      return;
    }
    setArmedId(id);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setArmedId(null), timeoutMs);
  }
  return { armedId, confirm };
}
