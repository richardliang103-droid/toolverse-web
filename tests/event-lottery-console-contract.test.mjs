import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("..", import.meta.url);

async function source(relativePath) {
  return readFile(fileURLToPath(new URL(relativePath, root)), "utf8");
}

test("event lottery loads its stylesheet once from the route layout and keeps its utility selector scoped", async () => {
  const [layout, consolePage, stagePage, remotePage, styles, settingsTab] = await Promise.all([
    source("app/tools/event-lottery/layout.tsx"),
    source("app/tools/event-lottery/page.tsx"),
    source("app/tools/event-lottery/stage/page.tsx"),
    source("app/tools/event-lottery/remote/page.tsx"),
    source("app/tools/event-lottery/event-lottery.css"),
    source("app/tools/event-lottery/settings-tab.tsx"),
  ]);

  assert.match(layout, /import "\.\/event-lottery\.css";/);
  for (const page of [consolePage, stagePage, remotePage]) {
    assert.doesNotMatch(page, /event-lottery\.css/);
  }
  assert.match(styles, /^\.event-lottery-field-suffix \{/m);
  assert.doesNotMatch(styles, /^\.field-suffix \{/m);
  assert.match(settingsTab, /className="event-lottery-field-suffix"/);
});

test("event lottery keeps tab state mounted and guards draw operations at the controller boundary", async () => {
  const [consoleSource, stageSource, prizesSource] = await Promise.all([
    source("app/tools/event-lottery/event-lottery-console.tsx"),
    source("app/tools/event-lottery/stage/event-lottery-stage.tsx"),
    source("app/tools/event-lottery/prizes-tab.tsx"),
  ]);
  const children = [
    ["settings", "SettingsTab", "app/tools/event-lottery/settings-tab.tsx"],
    ["prizes", "PrizesTab", "app/tools/event-lottery/prizes-tab.tsx"],
    ["draw", "DrawTab", "app/tools/event-lottery/draw-tab.tsx"],
    ["history", "HistoryTab", "app/tools/event-lottery/history-tab.tsx"],
  ];

  for (const [tabId, component, path] of children) {
    assert.match(consoleSource, new RegExp(`<${component}\\s+[\\s\\S]*?active=\\{activeTab === "${tabId}"\\}`));
    const childSource = await source(path);
    const firstHook = childSource.search(/\buse(?:State|Ref|Memo)\s*(?:<[^>]*>)?\(/);
    const guard = childSource.indexOf("if (!active) return null;");
    assert.ok(firstHook >= 0 && guard > firstHook, `${component} must keep its local state mounted before hiding inactive content`);
  }

  for (const handler of ["handlePrepareStage", "handleStartDraw"]) {
    assert.match(consoleSource, new RegExp(`async function ${handler}\\(prize: EventPrize\\) \\{\\n    if \\(drawLocked\\) return;`));
  }

  const previewHandlerStart = consoleSource.indexOf("async function handleShowPrizeWinners");
  const previewHandlerEnd = consoleSource.indexOf("\n  }\n\n  function handleExportRemainingCsv", previewHandlerStart);
  const previewHandler = consoleSource.slice(previewHandlerStart, previewHandlerEnd);
  const stopPreview = previewHandler.indexOf("if (state.stagePreview?.prizeId === prizeId)");
  const lockGuard = previewHandler.indexOf("if (drawLocked) return;");
  const startPreview = previewHandler.indexOf("previewPrizeWinnersAction");
  assert.ok(stopPreview >= 0 && lockGuard > stopPreview && startPreview > lockGuard, "stopping an active preview must remain available, while starting one is lock-guarded");
  assert.match(prizesSource, /drawLocked: boolean;/);
  assert.match(prizesSource, /disabled=\{state\.stagePreview\?\.prizeId !== prize\.id && \(drawLocked \|\| !state\.winners\.some/);

  assert.match(stageSource, /stagePreviewCompleteAt\(state\.stagePreview\)/);
  assert.match(stageSource, /state\.stagePreview\?\.revealAt/);
  assert.match(stageSource, /const completeAt = pending \? pendingRevealCompleteAt\(pending\) : noticeUntil \|\| previewCompleteAt;/);
});
