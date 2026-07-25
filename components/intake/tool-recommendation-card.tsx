"use client";

import { useState } from "react";
import type { IntakeDetection, IntakeRecommendation } from "@/lib/intake/types";
import { getToolManifest } from "@/lib/tools";

type ToolRecommendationCardProps = {
  detection: IntakeDetection;
  /** 有幾個檔案／字元共用這個偵測結果，純粹給標題用。 */
  itemCount?: number;
  /** 這幾個檔案的副檔名或宣告型別跟偵測出來的格式對不上，值是不一致的數量。 */
  mismatchCount?: number;
  /** 判斷點下去能不能直接把內容帶到下一個工具，決定按鈕文字是「前往」還是「前往並帶入」。 */
  canCarryOver: (slug: string) => boolean;
  onSelect: (slug: string) => void;
};

function ToolButton({ recommendation, carriesOver, onSelect }: { recommendation: IntakeRecommendation; carriesOver: boolean; onSelect: (slug: string) => void }) {
  const manifest = getToolManifest(recommendation.slug);
  if (!manifest) return null;
  return (
    <li className="intake-recommendation">
      <button className="button button-secondary intake-recommendation-button" type="button" onClick={() => onSelect(recommendation.slug)}>
        <span className="intake-recommendation-symbol" aria-hidden="true">{manifest.symbol}</span>
        <span className="intake-recommendation-copy">
          <strong>{manifest.name}</strong>
          <small>{recommendation.reason}</small>
        </span>
        <span className="intake-recommendation-arrow" aria-hidden="true">{carriesOver ? "帶入 →" : "→"}</span>
      </button>
    </li>
  );
}

export function ToolRecommendationCard({ detection, itemCount, mismatchCount, canCarryOver, onSelect }: ToolRecommendationCardProps) {
  const [expanded, setExpanded] = useState(false);
  const shownSlugs = new Set(detection.recommendedTools.map((item) => item.slug));
  const rest = detection.allTools.filter((item) => !shownSlugs.has(item.slug));

  return (
    <div className="intake-result">
      <div className="intake-result-heading">
        <span className="intake-result-type">{detection.label}{itemCount && itemCount > 1 ? `（${itemCount} 個檔案）` : ""}</span>
        {mismatchCount ? <span className="intake-result-warning">{mismatchCount} 個檔案的副檔名跟實際格式不符，已依實際內容判斷</span> : null}
      </div>

      {detection.recommendedTools.length > 0
        ? <ul className="intake-recommendation-list">
            {detection.recommendedTools.map((recommendation) => (
              <ToolButton key={recommendation.slug} recommendation={recommendation} carriesOver={canCarryOver(recommendation.slug)} onSelect={onSelect} />
            ))}
          </ul>
        : <p className="intake-empty">沒有特別推薦的工具，你可以從下面選一個，或手動瀏覽所有工具。</p>}

      {rest.length > 0 && (
        expanded
          ? <ul className="intake-recommendation-list intake-recommendation-list-secondary">
              {rest.map((recommendation) => (
                <ToolButton key={recommendation.slug} recommendation={recommendation} carriesOver={canCarryOver(recommendation.slug)} onSelect={onSelect} />
              ))}
            </ul>
          : <button className="intake-expand" type="button" onClick={() => setExpanded(true)}>查看全部適用工具（{rest.length}）</button>
      )}

      {detection.allTools.length === 0 && (
        <a className="intake-expand" href="#tools">手動選擇工具 →</a>
      )}
    </div>
  );
}
