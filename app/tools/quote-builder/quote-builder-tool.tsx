"use client";

import { useEffect, useRef, useState } from "react";
import {
  MAX_ITEMS,
  TAX_MODES,
  TAX_MODE_LABELS,
  computeQuoteTotals,
  createEmptyQuote,
  createItem,
  createSampleQuote,
  formatMoney,
  layoutQuote,
  parseQuote,
  quoteFilename,
  sanitizeQuote,
  serializeQuote,
} from "@/lib/quote-builder";
import type { DiscountType, Quote, QuoteItem, TaxMode } from "@/lib/quote-builder";
import { QuoteSvg } from "./quote-svg";
import type { QuoteSvgHandle } from "./quote-svg";

const STORAGE_KEY = "toolverse:quote-builder:v1";

const DISCOUNT_LABELS: Record<DiscountType, string> = {
  none: "不折扣",
  amount: "折抵金額（元）",
  percent: "折扣百分比（%）",
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function QuoteBuilderTool() {
  const [quote, setQuote] = useState<Quote | null>(null);
  // 還原完成前不寫回 localStorage，避免初始值把使用者的草稿蓋掉。
  const [hydrated, setHydrated] = useState(false);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: "info" | "error" } | null>(null);

  const exportSvgRef = useRef<QuoteSvgHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let restored: Quote | null = null;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) restored = sanitizeQuote(JSON.parse(saved));
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    // 還原此裝置的草稿需要一次性的 client hydration；hydrated 必須在 quote 之後
    // 才翻成 true，下面那個存檔 effect 才不會在還原完成前把草稿蓋掉。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuote(restored ?? createSampleQuote());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || !quote) return;
    try {
      localStorage.setItem(STORAGE_KEY, serializeQuote(quote));
    } catch {
      // 儲存空間滿了或被瀏覽器擋下時，繼續讓使用者編輯，不打斷流程。
    }
  }, [quote, hydrated]);

  useEffect(() => () => { if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current); }, []);

  function showNotice(message: string, tone: "info" | "error" = "info") {
    setNotice({ message, tone });
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 3200);
  }

  function update(updater: (previous: Quote) => Quote) {
    setQuote((previous) => (previous ? updater(previous) : previous));
  }

  function updateItem(id: string, patch: Partial<QuoteItem>) {
    update((previous) => ({ ...previous, items: previous.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) }));
  }

  function addItem() {
    update((previous) => (previous.items.length >= MAX_ITEMS
      ? previous
      : { ...previous, items: [...previous.items, createItem()] }));
  }

  function deleteItem(id: string) {
    update((previous) => {
      const remaining = previous.items.filter((item) => item.id !== id);
      return { ...previous, items: remaining.length > 0 ? remaining : [createItem()] };
    });
    if (focusedItemId === id) setFocusedItemId(null);
  }

  function exportSvgMarkup() {
    // 讀的是下面那份「永遠不帶聚焦高亮」的隱藏 SVG，而不是畫面上預覽的那份——
    // 表單聚焦只是編輯時的視覺提示，不該烙進寄給客戶的 PNG／SVG。
    const markup = exportSvgRef.current?.exportSvg();
    if (!markup) { showNotice("報價單尚未就緒，請再試一次", "error"); return null; }
    return markup;
  }

  function downloadSvg() {
    if (!quote) return;
    const markup = exportSvgMarkup();
    if (markup) downloadBlob(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }), `${quoteFilename(quote)}.svg`);
  }

  function pngBlob(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const markup = exportSvgMarkup();
      if (!markup || !layout) { resolve(null); return; }
      const image = new Image();
      const source = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
      image.onload = () => {
        const scale = 2;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(layout.width * scale);
        canvas.height = Math.round(layout.height * scale);
        const context = canvas.getContext("2d");
        if (!context) { resolve(null); URL.revokeObjectURL(source); return; }
        context.scale(scale, scale);
        context.drawImage(image, 0, 0, layout.width, layout.height);
        canvas.toBlob((blob) => { resolve(blob); URL.revokeObjectURL(source); }, "image/png");
      };
      image.onerror = () => { URL.revokeObjectURL(source); resolve(null); };
      image.src = source;
    });
  }

  async function downloadPng() {
    if (!quote) return;
    const blob = await pngBlob();
    if (blob) downloadBlob(blob, `${quoteFilename(quote)}.png`);
    else showNotice("PNG 產生失敗，請改下載 SVG", "error");
  }

  function downloadJson() {
    if (!quote) return;
    downloadBlob(new Blob([serializeQuote(quote)], { type: "application/json;charset=utf-8" }), `${quoteFilename(quote)}.json`);
  }

  async function importFile(file: File) {
    try {
      const parsed = parseQuote(await file.text());
      if (!parsed) { showNotice("無法解析這個檔案 — 請使用本工具匯出的 JSON", "error"); return; }
      setQuote(parsed);
      setFocusedItemId(null);
      showNotice("已匯入報價單，可以繼續編輯");
    } catch {
      showNotice("讀取檔案失敗，請確認內容是本工具匯出的 JSON", "error");
    }
  }

  function resetQuote() {
    setQuote(createEmptyQuote());
    setFocusedItemId(null);
    showNotice("已清空，開始一張新的報價單");
  }

  const totals = quote ? computeQuoteTotals(quote) : null;
  const layout = quote && totals ? layoutQuote(quote, totals) : null;

  if (!quote || !totals || !layout) {
    return (
      <section className="workspace quote-workspace page-shell" aria-label="報價單產生器">
        <div className="gantt-loading">正在載入這台裝置上的草稿…</div>
      </section>
    );
  }

  return (
    <section className="workspace quote-workspace page-shell" aria-label="報價單產生器">
      <div className="panel">
        <div className="panel-header">
          <h2>報價內容</h2>
          <span className="panel-meta">{quote.items.length} 個品項・總計 NT$ {formatMoney(totals.grandTotal)}</span>
        </div>

        {notice && <p className={`gantt-notice gantt-notice-${notice.tone}`} role="status">{notice.message}</p>}

        <div className="quote-field-grid">
          <label className="field-label" htmlFor="quote-title">報價單標題
            <input id="quote-title" className="key-input" value={quote.title} maxLength={40} onChange={(event) => update((previous) => ({ ...previous, title: event.target.value }))} onBlur={() => update((previous) => ({ ...previous, title: previous.title.trim() || "報價單" }))} />
          </label>
          <label className="field-label" htmlFor="quote-number">報價單號
            <input id="quote-number" className="key-input" value={quote.number} maxLength={30} placeholder="例：Q-2026-001" onChange={(event) => update((previous) => ({ ...previous, number: event.target.value }))} />
          </label>
          <label className="field-label" htmlFor="quote-issue-date">報價日期
            <input id="quote-issue-date" className="key-input" type="date" value={quote.issueDate} onChange={(event) => update((previous) => ({ ...previous, issueDate: event.target.value }))} />
          </label>
          <label className="field-label" htmlFor="quote-valid-until">有效期限
            <input id="quote-valid-until" className="key-input" type="date" value={quote.validUntil} onChange={(event) => update((previous) => ({ ...previous, validUntil: event.target.value }))} />
          </label>
        </div>

        <h3 className="equity-subheading">報價方（我方）</h3>
        <div className="quote-field-grid">
          <label className="field-label" htmlFor="quote-seller-name">公司／個人名稱
            <input id="quote-seller-name" className="key-input" value={quote.seller.name} maxLength={60} onChange={(event) => update((previous) => ({ ...previous, seller: { ...previous.seller, name: event.target.value } }))} />
          </label>
          <label className="field-label" htmlFor="quote-seller-tax-id">統一編號
            <input id="quote-seller-tax-id" className="key-input" value={quote.seller.taxId} inputMode="numeric" maxLength={8} placeholder="8 碼數字，可留空" onChange={(event) => update((previous) => ({ ...previous, seller: { ...previous.seller, taxId: event.target.value.replace(/\D/g, "").slice(0, 8) } }))} />
          </label>
        </div>
        <label className="field-label" htmlFor="quote-seller-contact">聯絡方式（地址、電話、Email，可多行）
          <textarea id="quote-seller-contact" className="participant-input participant-input-compact quote-textarea" value={quote.seller.contact} maxLength={200} rows={3} onChange={(event) => update((previous) => ({ ...previous, seller: { ...previous.seller, contact: event.target.value } }))} />
        </label>

        <h3 className="equity-subheading">客戶</h3>
        <div className="quote-field-grid">
          <label className="field-label" htmlFor="quote-buyer-name">公司名稱
            <input id="quote-buyer-name" className="key-input" value={quote.buyer.name} maxLength={60} onChange={(event) => update((previous) => ({ ...previous, buyer: { ...previous.buyer, name: event.target.value } }))} />
          </label>
          <label className="field-label" htmlFor="quote-buyer-tax-id">統一編號
            <input id="quote-buyer-tax-id" className="key-input" value={quote.buyer.taxId} inputMode="numeric" maxLength={8} placeholder="8 碼數字，可留空" onChange={(event) => update((previous) => ({ ...previous, buyer: { ...previous.buyer, taxId: event.target.value.replace(/\D/g, "").slice(0, 8) } }))} />
          </label>
          <label className="field-label" htmlFor="quote-buyer-person">聯絡人
            <input id="quote-buyer-person" className="key-input" value={quote.buyerContactPerson} maxLength={40} placeholder="例：王大明 採購經理" onChange={(event) => update((previous) => ({ ...previous, buyerContactPerson: event.target.value }))} />
          </label>
        </div>
        <label className="field-label" htmlFor="quote-buyer-contact">客戶聯絡方式（可多行）
          <textarea id="quote-buyer-contact" className="participant-input participant-input-compact quote-textarea" value={quote.buyer.contact} maxLength={200} rows={3} onChange={(event) => update((previous) => ({ ...previous, buyer: { ...previous.buyer, contact: event.target.value } }))} />
        </label>

        <h3 className="equity-subheading">品項</h3>
        <div className="csv-table-scroll">
          <table className="csv-table quote-items-table">
            <thead>
              <tr>
                <th className="csv-corner" aria-hidden="true" />
                <th>品名</th>
                <th>規格說明</th>
                <th>數量</th>
                <th>單價</th>
                <th>小計</th>
              </tr>
            </thead>
            <tbody>
              {quote.items.map((item, index) => (
                <tr key={item.id} className={item.id === focusedItemId ? "gantt-row-selected" : undefined}>
                  <td className="csv-row-tools">
                    <button className="gantt-row-delete" type="button" aria-label={`刪除第 ${index + 1} 個品項`} onClick={() => deleteItem(item.id)}>✕</button>
                  </td>
                  <td><input className="csv-cell" aria-label={`第 ${index + 1} 個品項的品名`} value={item.name} maxLength={80} onFocus={() => setFocusedItemId(item.id)} onBlur={() => setFocusedItemId(null)} onChange={(event) => updateItem(item.id, { name: event.target.value })} /></td>
                  <td><input className="csv-cell" aria-label={`第 ${index + 1} 個品項的規格說明`} value={item.spec} maxLength={160} placeholder="選填" onFocus={() => setFocusedItemId(item.id)} onBlur={() => setFocusedItemId(null)} onChange={(event) => updateItem(item.id, { spec: event.target.value })} /></td>
                  <td><input className="csv-cell quote-cell-number" aria-label={`第 ${index + 1} 個品項的數量`} type="number" min={0} step="0.01" value={item.quantity} onFocus={() => setFocusedItemId(item.id)} onBlur={() => setFocusedItemId(null)} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) updateItem(item.id, { quantity: Math.min(Math.max(value, 0), 999999) }); }} /></td>
                  <td><input className="csv-cell quote-cell-number" aria-label={`第 ${index + 1} 個品項的單價`} type="number" min={0} step="1" value={item.unitPrice} onFocus={() => setFocusedItemId(item.id)} onBlur={() => setFocusedItemId(null)} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) updateItem(item.id, { unitPrice: Math.min(Math.max(Math.round(value), 0), 99999999) }); }} /></td>
                  <td className="quote-cell-amount">{formatMoney(totals.itemTotals[index]?.amount ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="csv-actions quote-item-actions">
          <button className="button button-small button-blue" type="button" onClick={addItem} disabled={quote.items.length >= MAX_ITEMS}>＋ 品項</button>
          <span className="panel-meta">最多 {MAX_ITEMS} 個品項</span>
        </div>

        <h3 className="equity-subheading">稅額與折扣</h3>
        <fieldset className="quote-tax-modes">
          <legend className="sr-only">報價稅別</legend>
          {TAX_MODES.map((mode) => (
            <label key={mode} className="check-row">
              <input type="radio" name="quote-tax-mode" value={mode} checked={quote.taxMode === mode} onChange={() => update((previous) => ({ ...previous, taxMode: mode as TaxMode }))} />
              {TAX_MODE_LABELS[mode]}
            </label>
          ))}
        </fieldset>
        <p className="key-note">
          {quote.taxMode === "inclusive"
            ? "含稅報價：你填的單價已經內含營業稅，總計就是品項合計（扣折扣後）；未稅金額由總計 ÷ 1.05 回推。"
            : "未稅報價：你填的單價不含營業稅，稅額 = 未稅金額 × 5%，總計 = 未稅金額 + 稅額。"}
        </p>

        <div className="quote-field-grid">
          <label className="field-label" htmlFor="quote-discount-type">折扣方式（一律於稅前套用）
            <select id="quote-discount-type" className="key-input" value={quote.discountType} onChange={(event) => update((previous) => ({ ...previous, discountType: event.target.value as DiscountType }))}>
              {(Object.keys(DISCOUNT_LABELS) as DiscountType[]).map((type) => <option key={type} value={type}>{DISCOUNT_LABELS[type]}</option>)}
            </select>
          </label>
          {quote.discountType !== "none" && (
            <label className="field-label" htmlFor="quote-discount-value">{quote.discountType === "percent" ? "折扣百分比" : "折抵金額"}
              <input id="quote-discount-value" className="key-input" type="number" min={0} max={quote.discountType === "percent" ? 100 : undefined} step={quote.discountType === "percent" ? "0.01" : "1"} value={quote.discountValue} onChange={(event) => { const value = Number(event.target.value); if (!Number.isFinite(value)) return; update((previous) => ({ ...previous, discountValue: previous.discountType === "percent" ? Math.min(Math.max(value, 0), 100) : Math.max(Math.round(value), 0) })); }} />
            </label>
          )}
        </div>

        <h3 className="equity-subheading">付款條件與備註</h3>
        <label className="field-label" htmlFor="quote-payment-terms">付款條件
          <textarea id="quote-payment-terms" className="participant-input participant-input-compact quote-textarea" value={quote.paymentTerms} maxLength={300} rows={3} placeholder="例：簽約付 30%，驗收後 70%，月結 30 天。" onChange={(event) => update((previous) => ({ ...previous, paymentTerms: event.target.value }))} />
        </label>
        <label className="field-label" htmlFor="quote-notes">備註
          <textarea id="quote-notes" className="participant-input participant-input-compact quote-textarea" value={quote.notes} maxLength={300} rows={3} placeholder="例：本報價未含網域與主機費用。" onChange={(event) => update((previous) => ({ ...previous, notes: event.target.value }))} />
        </label>
      </div>

      <div className="panel panel-tinted quote-preview-panel">
        <div className="panel-header"><h2>預覽</h2><span className="panel-meta">白底輸出，可直接寄給客戶</span></div>

        <dl className="quote-summary">
          <div><dt>品項合計</dt><dd>NT$ {formatMoney(totals.itemsSubtotal)}</dd></div>
          {quote.discountType !== "none" && <div><dt>折扣（稅前）</dt><dd>-NT$ {formatMoney(totals.discountAmount)}</dd></div>}
          <div><dt>未稅金額</dt><dd>NT$ {formatMoney(totals.subtotal)}</dd></div>
          <div><dt>營業稅 5%</dt><dd>NT$ {formatMoney(totals.taxAmount)}</dd></div>
          <div className="quote-summary-total"><dt>總計（含稅）</dt><dd>NT$ {formatMoney(totals.grandTotal)}</dd></div>
        </dl>
        <p className="quote-verify-note">驗算：未稅 {formatMoney(totals.subtotal)} ＋ 稅額 {formatMoney(totals.taxAmount)} ＝ 總計 {formatMoney(totals.grandTotal)}</p>

        <div className="gantt-canvas quote-canvas">
          <QuoteSvg quote={quote} layout={layout} highlightItemId={focusedItemId} />
        </div>
        {/* 匯出專用、不顯示的第二份 SVG：永遠不帶聚焦高亮，PNG／SVG 都讀這一份。 */}
        <div aria-hidden="true" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0, pointerEvents: "none" }}>
          <QuoteSvg ref={exportSvgRef} quote={quote} layout={layout} highlightItemId={null} />
        </div>

        <div className="export-toolbar">
          <button className="button button-small button-secondary" type="button" onClick={downloadPng}>下載 PNG</button>
          <button className="button button-small button-secondary" type="button" onClick={downloadSvg}>下載 SVG</button>
          <button className="button button-small button-secondary" type="button" onClick={downloadJson}>下載 JSON</button>
          <button className="button button-small button-secondary" type="button" onClick={() => fileInputRef.current?.click()}>匯入 JSON</button>
          <button className="button button-small button-coral" type="button" onClick={resetQuote}>清空重來</button>
          <input ref={fileInputRef} className="file-input" type="file" accept="application/json,.json" aria-label="匯入 JSON 檔" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ""; }} />
        </div>
      </div>
    </section>
  );
}
