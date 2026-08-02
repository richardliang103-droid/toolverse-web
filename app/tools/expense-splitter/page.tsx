import { ToolInfo } from "@/components/tool-info";
import { ExpenseSplitterTool } from "./expense-splitter-tool";

export default function ExpenseSplitterPage() {
  return <main className="page-shell tool-page">
    <section className="tool-intro">
      <p className="eyebrow">實用工具</p>
      <h1>分帳結算</h1>
      <p>記下誰先付、哪些人要分，立刻整理成清楚的轉帳建議。資料只留在這台裝置。</p>
    </section>
    <ExpenseSplitterTool />
    <ToolInfo slug="expense-splitter" />
  </main>;
}
