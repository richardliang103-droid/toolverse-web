import type { Metadata } from "next";
import { EventLotteryRemote } from "./event-lottery-remote";
import "../event-lottery.css";

export const metadata: Metadata = {
  title: "活動抽獎手機遙控",
  description: "掃描活動抽獎控制台的 QR Code 後開啟的手機遙控頁，只能推進舞台的下一步，不會顯示任何參加者或得獎者資料。",
  robots: { index: false, follow: false },
};

export default function EventLotteryRemotePage() {
  return <EventLotteryRemote />;
}
