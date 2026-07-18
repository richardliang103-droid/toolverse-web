export type Roster = { id: string; name: string; members: string[] };

export const ROSTERS_STORAGE_KEY = "toolverse:rosters:v1";
export const MAX_ROSTERS = 12;
export const MAX_ROSTER_MEMBERS = 500;

/** localStorage 可能被寫壞；逐欄驗證，救得回多少是多少。 */
export function sanitizeRosters(value: unknown): Roster[] {
  if (!Array.isArray(value)) return [];
  const rosters: Roster[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const data = item as Record<string, unknown>;
    if (typeof data.id !== "string" || data.id === "" || seen.has(data.id)) continue;
    const members = Array.isArray(data.members)
      ? data.members.filter((member): member is string => typeof member === "string" && member.trim() !== "").map((member) => member.trim()).slice(0, MAX_ROSTER_MEMBERS)
      : [];
    if (members.length === 0) continue;
    seen.add(data.id);
    rosters.push({
      id: data.id,
      name: typeof data.name === "string" && data.name.trim() ? data.name.trim().slice(0, 30) : `名單 ${rosters.length + 1}`,
      members,
    });
    if (rosters.length >= MAX_ROSTERS) break;
  }
  return rosters;
}

export function rosterDefaultName(members: string[], existingCount: number) {
  const first = members[0] ?? "";
  const base = first.length > 8 ? `${first.slice(0, 7)}…` : first;
  return base ? `${base} 等 ${members.length} 人` : `名單 ${existingCount + 1}`;
}
