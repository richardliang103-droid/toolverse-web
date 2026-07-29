import type { Metadata } from "next";
import { EventLotteryStage } from "./event-lottery-stage";

export const metadata: Metadata = {
  title: "活動抽獎舞台展示",
  description: "活動抽獎控制台的投影舞台，全螢幕顯示目前獎項與抽選結果。",
  robots: { index: false, follow: true },
};

export default function EventLotteryStagePage() {
  return <EventLotteryStage />;
}
