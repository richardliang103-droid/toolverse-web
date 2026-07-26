"use client";

import type { HandoffStatus } from "./use-handoff";

export function HandoffStatusBanner({ status }: { status: HandoffStatus }) {
  if (!status) return null;
  return (
    <div className={status.kind === "error" ? "gantt-notice gantt-notice-error handoff-status" : "gantt-notice gantt-notice-info handoff-status"} role={status.kind === "error" ? "alert" : "status"}>
      <span>{status.text}</span>
      {status.action && <button className="button button-small button-secondary" type="button" onClick={status.action.onClick}>{status.action.label}</button>}
    </div>
  );
}
