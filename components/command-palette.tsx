"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePersonalTools } from "@/components/personal/use-personal-tools";
import { orderToolsForPersonal } from "@/lib/personal-tools";
import { filterTools } from "@/lib/tools";

/**
 * ⌘K／Ctrl+K 命令面板：任何頁面都能直接跳到任一工具，不必先回首頁。
 *
 * 用原生 <dialog showModal()>，焦點鎖定、Esc 關閉、背景 inert 與 ::backdrop
 * 都由瀏覽器負責，不用自己刻一套（也就不會刻壞）。
 *
 * 開關狀態刻意「不」鏡射成 React state——dialog.open 本身就是唯一真相。
 * 鏡射的話，使用者按 Esc（瀏覽器直接關閉，不經過 React）就會讓兩邊不同步，
 * 之後 setOpen(true) 因為值沒變而不觸發重繪，面板就再也打不開了。
 */
export function CommandPalette() {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const { favoriteSlugs, recentSlugs } = usePersonalTools();

  const results = useMemo(
    () => orderToolsForPersonal(filterTools(query, "all"), favoriteSlugs, recentSlugs),
    [query, favoriteSlugs, recentSlugs],
  );
  const favorites = useMemo(() => new Set(favoriteSlugs), [favoriteSlugs]);
  const recents = useMemo(() => new Set(recentSlugs), [recentSlugs]);

  const openPalette = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    setQuery("");
    setActive(0);
    dialog.showModal();
    inputRef.current?.focus();
  }, []);

  const closePalette = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isPaletteKey = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (!isPaletteKey) return;
      // 在輸入框裡也要能開——這是全域導覽，不是文字編輯快速鍵。
      event.preventDefault();
      if (dialogRef.current?.open) closePalette();
      else openPalette();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openPalette, closePalette]);

  function go(slug: string) {
    closePalette();
    router.push(`/tools/${slug}`);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActive((previous) => (previous + delta + results.length) % results.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const tool = results[active];
      if (tool) go(tool.slug);
    }
  }

  return (
    <>
      <button
        className="palette-trigger"
        type="button"
        onClick={openPalette}
        aria-label="搜尋工具"
      >
        <span aria-hidden="true">⌕</span>
        <kbd aria-hidden="true">⌘K</kbd>
      </button>

      <dialog
        ref={dialogRef}
        className="palette"
        aria-label="搜尋並跳到工具"
        // 點到 dialog 本身（也就是 backdrop 區域）才關閉，點面板內容不關。
        onClick={(event) => { if (event.target === dialogRef.current) closePalette(); }}
      >
        <div className="palette-body">
          <label className="sr-only" htmlFor="palette-input">搜尋工具</label>
          <input
            ref={inputRef}
            id="palette-input"
            className="palette-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[active] ? `palette-option-${results[active].slug}` : undefined}
            autoComplete="off"
            placeholder="搜尋工具或格式… 例如：甘特、PNG、PDF"
            value={query}
            // 關鍵字改變時選取移回第一筆，否則游標會停在已經被過濾掉的位置。
            onChange={(event) => { setQuery(event.target.value); setActive(0); }}
            onKeyDown={onInputKeyDown}
          />
          {results.length === 0
            ? <p className="palette-empty">找不到符合「{query}」的工具</p>
            : <ul className="palette-results" id="palette-results" role="listbox" aria-label="工具搜尋結果">
                {results.map((tool, index) => (
                  <li key={tool.slug} role="none">
                    <button
                      id={`palette-option-${tool.slug}`}
                      className={`palette-option${index === active ? " palette-option-active" : ""}`}
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      tabIndex={-1}
                      onMouseMove={() => setActive(index)}
                      onClick={() => go(tool.slug)}
                    >
                      <span className="palette-symbol" aria-hidden="true">{tool.symbol}</span>
                      <span className="palette-text">
                        <strong>{tool.name}</strong>
                        <small>{tool.description}</small>
                      </span>
                      {favorites.has(tool.slug)
                        ? <span className="palette-personal-badge">收藏</span>
                        : recents.has(tool.slug) && <span className="palette-personal-badge">最近</span>}
                    </button>
                  </li>
                ))}
              </ul>}
          <p className="palette-hint" aria-hidden="true">↑↓ 選擇 · Enter 前往 · Esc 關閉</p>
        </div>
      </dialog>
    </>
  );
}
