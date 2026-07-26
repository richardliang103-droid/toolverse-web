"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_PERSONAL_TOOLS_STATE,
  recordRecentTool,
  sanitizePersonalToolsState,
  setRecentTracking,
  toggleFavoriteTool,
  type PersonalToolsState,
} from "@/lib/personal-tools";
import { tools } from "@/lib/tools";

const STORAGE_KEY = "toolverse:personal-tools:v1";
const VALID_SLUGS = tools.map((tool) => tool.slug);

type PersonalToolsSnapshot = {
  state: PersonalToolsState;
  hydrated: boolean;
};

const SERVER_SNAPSHOT: PersonalToolsSnapshot = {
  state: DEFAULT_PERSONAL_TOOLS_STATE,
  hydrated: false,
};

let snapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();
let listeningForStorage = false;

function emit() {
  for (const listener of listeners) listener();
}

function parseStored(value: string | null): PersonalToolsState {
  if (!value) return { ...DEFAULT_PERSONAL_TOOLS_STATE };
  try {
    return sanitizePersonalToolsState(JSON.parse(value), VALID_SLUGS);
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* 儲存被封鎖時維持本頁預設值。 */ }
    return { ...DEFAULT_PERSONAL_TOOLS_STATE };
  }
}

function hydrate() {
  if (snapshot.hydrated || typeof window === "undefined") return;
  let state = { ...DEFAULT_PERSONAL_TOOLS_STATE };
  try { state = parseStored(localStorage.getItem(STORAGE_KEY)); } catch { /* 私密模式可能禁止讀取。 */ }
  snapshot = { state, hydrated: true };
  emit();
}

function handleStorage(event: StorageEvent) {
  if (event.key !== STORAGE_KEY) return;
  snapshot = { state: parseStored(event.newValue), hydrated: true };
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (typeof window !== "undefined" && !listeningForStorage) {
    window.addEventListener("storage", handleStorage);
    listeningForStorage = true;
  }
  hydrate();
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined" && listeningForStorage && listeners.size === 0) {
      window.removeEventListener("storage", handleStorage);
      listeningForStorage = false;
    }
  };
}

function update(transform: (state: PersonalToolsState) => PersonalToolsState) {
  hydrate();
  const next = transform(snapshot.state);
  if (next === snapshot.state) return;
  snapshot = { state: next, hydrated: true };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* 本頁仍可使用，只是不跨重新整理保存。 */ }
  emit();
}

export function toggleFavorite(slug: string) {
  update((state) => toggleFavoriteTool(state, slug, VALID_SLUGS));
}

export function recordRecentToolVisit(slug: string) {
  update((state) => recordRecentTool(state, slug, VALID_SLUGS));
}

export function setRecentTrackingEnabled(enabled: boolean) {
  update((state) => setRecentTracking(state, enabled));
}

export function usePersonalTools() {
  const current = useSyncExternalStore(subscribe, () => snapshot, () => SERVER_SNAPSHOT);
  return {
    ...current.state,
    hydrated: current.hydrated,
    toggleFavorite,
    setRecentTrackingEnabled,
  };
}
