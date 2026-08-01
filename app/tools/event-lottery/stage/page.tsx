import type { Metadata } from "next";
import { EventLotteryStage } from "./event-lottery-stage";
import "../event-lottery.css";

export const metadata: Metadata = {
  title: "公司尾牙幸運抽獎",
  description: "活動抽獎控制台的投影舞台，全螢幕顯示目前獎項與抽選結果。",
  robots: { index: false, follow: true },
};

export default function EventLotteryStagePage() {
  return <EventLotteryStage />;
}
