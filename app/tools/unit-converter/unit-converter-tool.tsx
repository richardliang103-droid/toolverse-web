"use client";

import { useEffect, useState } from "react";
import { UNIT_CATEGORIES, convertUnits, formatConverted, type UnitCategoryId } from "@/lib/units";

const STORAGE_KEY = "toolverse:unit-converter:v1";

export function UnitConverterTool() {
  const [category, setCategory] = useState<UnitCategoryId>("length");
  const [fromId, setFromId] = useState("cm");
  const [toId, setToId] = useState("inch");
  const [raw, setRaw] = useState("1");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved) as Record<string, unknown>;
        const group = UNIT_CATEGORIES.find((item) => item.id === data.category);
        if (group) {
          // 還原上次使用的類別與單位需要一次性的 client hydration。
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setCategory(group.id);
          if (group.units.some((unit) => unit.id === data.fromId)) setFromId(data.fromId as string);
          if (group.units.some((unit) => unit.id === data.toId)) setToId(data.toId as string);
        }
      }
    } catch { localStorage.removeItem(STORAGE_KEY); }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify({ category, fromId, toId }));
  }, [hydrated, category, fromId, toId]);

  const group = UNIT_CATEGORIES.find((item) => item.id === category)!;
  const value = Number(raw.replace(/,/g, ""));
  const result = convertUnits(category, fromId, toId, value);
  const fromUnit = group.units.find((unit) => unit.id === fromId);
  const toUnit = group.units.find((unit) => unit.id === toId);

  function switchCategory(next: UnitCategoryId) {
    const nextGroup = UNIT_CATEGORIES.find((item) => item.id === next)!;
    setCategory(next);
    setFromId(nextGroup.units[0].id);
    setToId(nextGroup.units[1].id);
  }

  function swap() {
    setFromId(toId);
    setToId(fromId);
  }

  return <section className="workspace unit-workspace page-shell" aria-label="單位換算工具">
    <div className="panel">
      <div className="panel-header"><h2>選擇單位</h2><span className="panel-meta">支援坪、甲、台斤等台制單位</span></div>
      <div className="flow-mode-toggle unit-category-row" role="radiogroup" aria-label="換算類別">
        {UNIT_CATEGORIES.map((item) => (
          <button key={item.id} type="button" className={`button button-small ${category === item.id ? "button-blue" : "button-secondary"}`} aria-pressed={category === item.id} onClick={() => switchCategory(item.id)}>{item.label}</button>
        ))}
      </div>
      <div className="unit-row">
        <label className="field-label" htmlFor="unit-value">數值
          <input id="unit-value" className="key-input" inputMode="decimal" value={raw} onChange={(event) => setRaw(event.target.value)} placeholder="輸入數值" />
        </label>
        <label className="field-label" htmlFor="unit-from">從
          <select id="unit-from" className="key-input" value={fromId} onChange={(event) => setFromId(event.target.value)}>
            {group.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.label}</option>)}
          </select>
        </label>
        <button className="button button-small button-secondary unit-swap" type="button" onClick={swap} aria-label="交換單位">⇄</button>
        <label className="field-label" htmlFor="unit-to">換成
          <select id="unit-to" className="key-input" value={toId} onChange={(event) => setToId(event.target.value)}>
            {group.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.label}</option>)}
          </select>
        </label>
      </div>
      <p className="key-note">換算即時完成、全程在瀏覽器本機；溫度為公式換算，其他類別以國際標準倍率計算。</p>
    </div>
    <div className="panel panel-tinted">
      <div className="panel-header"><h2>結果</h2><span className="panel-meta">{group.label}</span></div>
      {Number.isFinite(value) && raw.trim() !== ""
        ? <div className="unit-result">
            <p className="unit-result-main"><strong>{formatConverted(result)}</strong> {toUnit?.label}</p>
            <p className="unit-result-sub">{raw.trim()} {fromUnit?.label} =</p>
            <table className="unit-table" aria-label="其他單位對照">
              <tbody>
                {group.units.filter((unit) => unit.id !== fromId).map((unit) => (
                  <tr key={unit.id}><td>{unit.label}</td><td>{formatConverted(convertUnits(category, fromId, unit.id, value))}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        : <div className="result-stage"><div className="result-empty"><strong>輸入數值就會換算</strong>結果與整組單位對照會即時出現。</div></div>}
    </div>
  </section>;
}
