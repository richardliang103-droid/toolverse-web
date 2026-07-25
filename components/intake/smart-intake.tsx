"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IntakeDropZone } from "./intake-drop-zone";
import { ToolRecommendationCard } from "./tool-recommendation-card";
import { detectFileType } from "@/lib/intake/detect-file";
import { detectTextType } from "@/lib/intake/detect-text";
import { buildFileIntakeDetection, buildTextIntakeDetection } from "@/lib/intake/recommendations";
import type { IntakeDetection } from "@/lib/intake/types";
import { IMAGE_TOOL_SLUGS, TEXT_TOOL_SLUGS, putFileHandoff, putTextHandoff } from "@/lib/handoff";

type FileGroup = { key: string; detection: IntakeDetection; files: File[]; mismatchCount: number };

const IMAGE_RECEIVERS: readonly string[] = IMAGE_TOOL_SLUGS;
const TEXT_RECEIVERS: readonly string[] = TEXT_TOOL_SLUGS;
/** 讀取檔案開頭幾 KB 就夠判斷格式，不必等大檔案整份讀完。 */
const SNIFF_BYTES = 4096;

async function analyzeFiles(files: File[]): Promise<FileGroup[]> {
  const perFile = await Promise.all(files.map(async (file) => {
    const buffer = await file.slice(0, SNIFF_BYTES).arrayBuffer();
    const fileDetection = detectFileType({ name: file.name, declaredType: file.type, bytes: new Uint8Array(buffer) });
    return { file, fileDetection };
  }));

  const groups = new Map<string, FileGroup>();
  for (const { file, fileDetection } of perFile) {
    const key = fileDetection.category === "unknown" ? `unknown:${fileDetection.mimeType}` : fileDetection.mimeType;
    const existing = groups.get(key);
    if (existing) {
      existing.files.push(file);
      if (fileDetection.mismatch) existing.mismatchCount += 1;
    } else {
      groups.set(key, { key, detection: buildFileIntakeDetection(fileDetection), files: [file], mismatchCount: fileDetection.mismatch ? 1 : 0 });
    }
  }
  return [...groups.values()];
}

/**
 * 首頁的智慧入口：貼上文字或拖入檔案，推薦適合的工具。
 *
 * 偵測完全在本機執行（`lib/intake/` 全是純函式），這裡只負責收集輸入、
 * 呼叫偵測、把結果交給 `ToolRecommendationCard` 顯示。點下推薦工具時，
 * 如果目的地剛好是已經接了 Tool Handoff 的工具，就用 `lib/handoff.ts`
 * 把內容直接帶過去；不是的話單純導覽，讓使用者在那個工具頁自己選檔案——
 * 隨便塞一個沒有工具會去讀取的 pending handoff，只會變成之後某個
 * 不相干頁面莫名其妙收到一份舊資料。
 */
export function SmartIntake() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [textDetection, setTextDetection] = useState<IntakeDetection | null>(null);
  const [fileGroups, setFileGroups] = useState<FileGroup[]>([]);
  const [busy, setBusy] = useState(false);

  // 兩層防過期：文字用 debounce 計時器，檔案用遞增 id——晚丟出去的分析
  // 有可能因為 await 排隊而比新的一次先跑完，id 對不上就直接丟棄結果。
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analysisIdRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const isEmpty = text.trim() === "";
    // 清空時走 0ms 的同一條計時器路徑，不在 effect 本體裡直接呼叫 setState——
    // 兩種情況都是「非同步同步外部計時器狀態」，不該有一條分支抄捷徑。
    debounceRef.current = setTimeout(() => {
      setTextDetection(isEmpty ? null : buildTextIntakeDetection(detectTextType(text)));
    }, isEmpty ? 0 : 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [text]);

  const handleFiles = useCallback((files: FileList) => {
    const id = (analysisIdRef.current += 1);
    setBusy(true);
    void analyzeFiles([...files]).then((groups) => {
      if (id !== analysisIdRef.current) return; // 使用者在分析跑完前又丟了新的一批
      setFileGroups(groups);
    }).finally(() => {
      if (id === analysisIdRef.current) setBusy(false);
    });
  }, []);

  function goToTool(slug: string, detection: IntakeDetection, source: { file?: File; text?: string }) {
    if (detection.kind === "file" && source.file && IMAGE_RECEIVERS.includes(slug)) putFileHandoff(source.file, "smart-intake");
    else if (detection.kind === "text" && source.text !== undefined && TEXT_RECEIVERS.includes(slug)) putTextHandoff(source.text, "smart-intake");
    router.push(`/tools/${slug}`);
  }

  const hasContent = textDetection !== null || fileGroups.length > 0;

  return (
    <section className="intake-section page-shell" aria-label="智慧入口：貼上文字或拖入檔案取得工具建議">
      <div className="intake-intro">
        <h2>不確定要用哪個工具？</h2>
        <p>貼上文字，或把檔案拖進來，我們會依內容推薦合適的工具。</p>
      </div>
      <IntakeDropZone text={text} onTextChange={setText} onFiles={handleFiles} busy={busy} />

      {hasContent && (
        <div className="intake-results">
          {textDetection && (
            <ToolRecommendationCard
              detection={textDetection}
              canCarryOver={(slug) => TEXT_RECEIVERS.includes(slug)}
              onSelect={(slug) => goToTool(slug, textDetection, { text })}
            />
          )}
          {fileGroups.map((group) => (
            <ToolRecommendationCard
              key={group.key}
              detection={group.detection}
              itemCount={group.files.length}
              mismatchCount={group.mismatchCount}
              canCarryOver={(slug) => group.files.length === 1 && IMAGE_RECEIVERS.includes(slug)}
              onSelect={(slug) => goToTool(slug, group.detection, { file: group.files[0] })}
            />
          ))}
        </div>
      )}
    </section>
  );
}
