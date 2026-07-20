"use client";

import { useEffect, useState } from "react";
import { normalizeParticipants } from "@/lib/lottery";
import { MAX_ROSTERS, ROSTERS_STORAGE_KEY, rosterDefaultName, sanitizeRosters } from "@/lib/rosters";
import type { Roster } from "@/lib/rosters";

type RosterPickerProps = {
  /** 目前輸入框的原始文字（用來「儲存目前名單」）。 */
  currentText: string;
  /** 點選名單時把成員（一行一位）帶回輸入框。 */
  onLoad: (text: string) => void;
};

/** 抽獎與分組共用的名單庫：存幾組常用名單，兩個工具都能一鍵帶入。 */
export function RosterPicker({ currentText, onLoad }: RosterPickerProps) {
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(ROSTERS_STORAGE_KEY);
      if (saved) {
        // 還原共用名單庫需要一次性的 client hydration。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRosters(sanitizeRosters(JSON.parse(saved)));
      }
    } catch { localStorage.removeItem(ROSTERS_STORAGE_KEY); }
     
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(ROSTERS_STORAGE_KEY, JSON.stringify(rosters));
  }, [hydrated, rosters]);

  function saveCurrent() {
    const members = normalizeParticipants(currentText, true).map((participant) => participant.label);
    if (members.length === 0) return;
    setRosters((previous) => {
      const roster: Roster = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: rosterDefaultName(members, previous.length), members };
      return [...previous, roster].slice(-MAX_ROSTERS);
    });
  }

  function remove(id: string) {
    setRosters((previous) => previous.filter((roster) => roster.id !== id));
  }

  const canSave = normalizeParticipants(currentText, true).length > 0;
  if (!hydrated) return null;

  return (
    <div className="roster-picker">
      <span className="roster-picker-label">名單庫</span>
      {rosters.map((roster) => (
        <span className="roster-chip" key={roster.id}>
          <button type="button" className="roster-chip-load" title={`${roster.members.length} 人`} onClick={() => onLoad(roster.members.join("\n"))}>{roster.name}</button>
          <button type="button" className="roster-chip-delete" aria-label={`刪除名單 ${roster.name}`} onClick={() => remove(roster.id)}>✕</button>
        </span>
      ))}
      <button type="button" className="roster-save" disabled={!canSave || rosters.length >= MAX_ROSTERS} onClick={saveCurrent} title="把目前輸入的名單存起來，抽獎與分組工具都能使用">＋ 存目前名單</button>
    </div>
  );
}
