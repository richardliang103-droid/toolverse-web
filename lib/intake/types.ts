/** Smart Intake 共用型別。 */

export interface IntakeRecommendation {
  slug: string;
  reason: string;
  score: number;
}

export interface IntakeDetection {
  kind: "file" | "text";
  /** 內部型別代號，例如 `"image/png"`（檔案用 MIME）或 `"csv"`（文字用 IntakeTextType）。 */
  type: string;
  /** 給使用者看的一句話，例如「PNG 圖片」「CSV／TSV 表格」。 */
  label: string;
  confidence: number;
  /** 最多三個，依信心與策展順序排序，卡片預設只顯示這些。 */
  recommendedTools: IntakeRecommendation[];
  /** 「查看全部適用工具」展開後顯示的完整清單；文字型偵測沒有策展資料時會是空陣列。 */
  allTools: IntakeRecommendation[];
}
