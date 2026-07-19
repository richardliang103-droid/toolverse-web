"use client";

import { useEffect, useMemo, useState } from "react";
import { groupsToCsv, groupsToText, normalizeParticipants, parseSeparationRules, resolveGroupCount, splitIntoGroups } from "@/lib/groups";
import type { GroupingMode } from "@/lib/groups";
import { RosterPicker } from "@/components/roster-picker";

const STORAGE_KEY = "toolverse:groups:v1";
const TONE_COUNT = 4;

type StoredState = { raw: string; dedupe: boolean; mode: GroupingMode; countValue: number; sizeValue: number; groups: string[][]; separations: string };

function positiveInt(value: unknown, fallback: number) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

/** localStorage 可能被寫壞；逐欄驗證，避免整頁 render 掛掉。 */
function sanitizeStoredState(value: unknown): StoredState {
  const data = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const groups = Array.isArray(data.groups)
    ? data.groups
        .map((group) => (Array.isArray(group) ? group.filter((member): member is string => typeof member === "string") : []))
        .filter((group) => group.length > 0)
    : [];
  return {
    raw: typeof data.raw === "string" ? data.raw : "",
    dedupe: data.dedupe !== false,
    mode: data.mode === "bySize" ? "bySize" : "byCount",
    countValue: positiveInt(data.countValue, 2),
    separations: typeof data.separations === "string" ? data.separations : "",
    sizeValue: positiveInt(data.sizeValue, 4),
    groups,
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function RandomGroupsTool() {
  const [raw, setRaw] = useState("");
  const [dedupe, setDedupe] = useState(true);
  const [mode, setMode] = useState<GroupingMode>("byCount");
  const [countValue, setCountValue] = useState(2);
  const [sizeValue, setSizeValue] = useState(4);
  const [groups, setGroups] = useState<string[][]>([]);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [shuffleRound, setShuffleRound] = useState(0);
  const [separations, setSeparations] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = sanitizeStoredState(JSON.parse(saved));
        // 還原此裝置的名單需要一次性的 client hydration。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRaw(data.raw); setDedupe(data.dedupe); setMode(data.mode); setCountValue(data.countValue); setSizeValue(data.sizeValue); setGroups(data.groups); setSeparations(data.separations);
      }
    } catch { localStorage.removeItem(STORAGE_KEY); }
     
    setHydrated(true);
  }, []);

  // hydrated 之前不寫入，避免初始空狀態在還原完成前蓋掉既有資料。
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ raw, dedupe, mode, countValue, sizeValue, groups, separations }));
  }, [hydrated, raw, dedupe, mode, countValue, sizeValue, groups, separations]);

  const members = useMemo(() => normalizeParticipants(raw, dedupe), [raw, dedupe]);
  const currentValue = mode === "byCount" ? countValue : sizeValue;
  const expectedCount = resolveGroupCount(members.length, mode, currentValue);

  function handleSplit() {
    setError(""); setCopied(false);
    try {
      const result = splitIntoGroups(members, mode, currentValue, parseSeparationRules(separations, members));
      setGroups(result.groups);
      setShuffleRound((round) => round + 1); // 換 key 讓進場動畫重新播放
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "分組時發生錯誤");
    }
  }

  async function copyGroups() {
    try {
      await navigator.clipboard.writeText(groupsToText(groups));
      setCopied(true);
    } catch {
      setError("無法複製到剪貼簿，請手動選取結果複製");
    }
  }

  function downloadCsv() {
    downloadBlob(new Blob([groupsToCsv(groups)], { type: "text/csv;charset=utf-8" }), "toolverse-groups.csv");
  }

  function clearAll() {
    setRaw(""); setGroups([]); setError(""); setCopied(false);
  }

  const sizeSummary = useMemo(() => {
    if (expectedCount === 0 || members.length === 0) return "";
    const base = Math.floor(members.length / expectedCount);
    const larger = members.length % expectedCount;
    const range = larger === 0 ? `${base}` : `${base}–${base + 1}`;
    return `預計分成 ${expectedCount} 組，每組 ${range} 人`;
  }, [expectedCount, members.length]);

  return <section className="workspace groups-workspace page-shell" aria-label="隨機分組工具">
    <div className="panel">
      <div className="panel-header"><h2>名單與規則</h2><span className="panel-meta">共 {members.length} 人</span></div>
      <label className="sr-only" htmlFor="group-members">參加者名單，一行一位</label>
      <textarea id="group-members" className="participant-input participant-input-compact" value={raw} onChange={(event) => setRaw(event.target.value)} placeholder={'輸入或貼上名單，每行一位\n例如：\n小明\n小美\nAlex'} />
      <RosterPicker currentText={raw} onLoad={setRaw} /><div className="form-controls">
        <label className="check-row"><input type="checkbox" checked={dedupe} onChange={(event) => setDedupe(event.target.checked)} />移除重複名字</label>
      </div>
      <div className="flow-mode-toggle" role="radiogroup" aria-label="分組方式">
        <button type="button" className={`button button-small ${mode === "byCount" ? "button-blue" : "button-secondary"}`} aria-pressed={mode === "byCount"} onClick={() => setMode("byCount")}>分成幾組</button>
        <button type="button" className={`button button-small ${mode === "bySize" ? "button-blue" : "button-secondary"}`} aria-pressed={mode === "bySize"} onClick={() => setMode("bySize")}>每組幾人</button>
      </div>
      <div className="groups-value-row">
        <label className="number-field" htmlFor="group-value">{mode === "byCount" ? "組數" : "每組人數"}
          <input
            id="group-value"
            className="number-input"
            type="number"
            min="1"
            value={currentValue}
            onChange={(event) => {
              const next = positiveInt(event.target.value, 1);
              if (mode === "byCount") setCountValue(next); else setSizeValue(next);
            }}
          />
        </label>
        {sizeSummary && <span className="groups-forecast">{sizeSummary}</span>}
      </div>
      <label className="field-label groups-separations" htmlFor="group-separations">不同組名單（選填）
        <textarea id="group-separations" className="participant-input groups-separations-input" value={separations} onChange={(event) => setSeparations(event.target.value)} placeholder={"一行一條規則，成員用逗號分隔\n例如：小明,小美（兩人會被分進不同組）"} spellCheck={false} />
      </label>
      <button className="button button-blue draw-button" type="button" onClick={handleSplit} disabled={members.length === 0}>開始分組 ⁘</button>
      {error && <p className="error-message" role="alert">{error}</p>}
      <p className="key-note">使用 Web Crypto 安全隨機來源洗牌後輪流分配，各組人數最多差 1 人；名單只留在你的瀏覽器。</p>
    </div>
    <div className="panel panel-tinted">
      <div className="panel-header"><h2>分組結果</h2><span className="panel-meta">{groups.length > 0 ? `${groups.length} 組` : "尚未分組"}</span></div>
      {groups.length > 0
        ? <>
            <div className="groups-result-grid">
              {groups.map((group, index) => (
                <article
                  className={`group-card group-card-tone-${index % TONE_COUNT}`}
                  key={`${shuffleRound}-${index}`}
                  style={{ "--card-index": index } as React.CSSProperties}
                >
                  <h3>第 {index + 1} 組<span>{group.length} 人</span></h3>
                  <ol>{group.map((member, memberIndex) => <li className="animated-list-item" style={{ animationDelay: `${index * 70 + 140 + memberIndex * 45}ms` }} key={member}>{member}</li>)}</ol>
                </article>
              ))}
            </div>
            <div className="result-actions">
              <button className="button button-small button-secondary" type="button" onClick={copyGroups}>{copied ? "已複製 ✓" : "複製結果"}</button>
              <button className="button button-small button-secondary" type="button" onClick={downloadCsv}>下載 CSV</button>
              <button className="button button-small button-secondary" type="button" onClick={handleSplit}>重新分組</button>
              <button className="button button-small button-secondary" type="button" onClick={clearAll}>清空</button>
            </div>
          </>
        : <div className="result-stage"><div className="result-empty"><strong>準備好分組了嗎？</strong>在左側輸入名單、選好分組方式，按「開始分組」就會公平隨機分好。</div></div>}
    </div>
  </section>;
}
