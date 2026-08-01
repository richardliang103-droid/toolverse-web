"use client";

import { downloadBlob } from "@/lib/download";
import { MAX_IMAGE_DATA_URL_LENGTH } from "@/lib/event-lottery";
import { decodeTextBytes, type TextEncodingPreference } from "@/lib/text-encoding";

/**
 * 控制台各分頁共用的小工具：CSV 範本／讀檔解碼／圖片縮圖，以及畫面提示的型別。
 * 這些原本都是 event-lottery-console.tsx 的模組層函式；分頁拆成獨立元件後，
 * 若還留在 console 裡會造成「console 匯入分頁、分頁又回頭匯入 console」的
 * 循環相依，所以集中到這個沒有任何 UI 相依的模組。
 */

/** 畫面上方的提示訊息（綠色資訊／紅色錯誤）。 */
export type Notice = { text: string; tone: "info" | "error" };

/** CSV 匯入格式容易猜錯，提供範例檔案讓使用者照著填，而不是只靠文字說明。 */
export const PARTICIPANT_CSV_TEMPLATE = "部門,姓名,員工編號\r\n法金資訊部,梁O強,99999\r\n";
export const PRIZE_CSV_TEMPLATE = "抽獎順序,獎項,數量\r\n1,頭獎 台積電1張,1\r\n2,二獎 歐洲機票1張,1\r\n3,參加獎 電影票,10\r\n";

/** 讀檔並解碼：優先信任 BOM，沒有 BOM 時先試 UTF-8，失敗才落回 Big5／
 *  Windows-1252 的啟發式判斷（見 lib/text-encoding.ts，跟 CSV 編輯器／隨機分組
 *  共用同一套邏輯）。使用者也可以手動指定編碼覆蓋自動判斷。 */
export async function readCsvText(file: File, preference: TextEncodingPreference) {
  const bytes = await file.arrayBuffer();
  return decodeTextBytes(new Uint8Array(bytes), preference);
}

/** 範例 CSV 開頭加上 Excel 認得的 sep=, 宣告列，避免使用者 Windows 地區設定的
 *  清單分隔符號不是逗號時，雙擊開啟會整列被塞進同一欄；`lib/csv.ts` 重新上傳
 *  這份檔案時也認得這一行，不會誤判成一筆資料。 */
export function downloadCsvTemplate(content: string, filename: string) {
  downloadBlob(new Blob([`﻿sep=,\r\n${content}`], { type: "text/csv;charset=utf-8" }), filename);
}

type DecodedUploadImage = {
  width: number;
  height: number;
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void;
  close: () => void;
};

/** 依參考專案的 800px 寬度／JPEG 方式縮圖，再加上 Toolverse 的容量上限保護。 */
async function decodeUploadImage(file: File): Promise<DecodedUploadImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (context, width, height) => context.drawImage(bitmap, 0, 0, width, height),
        close: () => bitmap.close(),
      };
    } catch {
      // Safari 與部分圖片格式不支援 createImageBitmap；退回原版的 Image 解碼流程。
    }
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("圖片解碼失敗"));
      element.src = objectUrl;
    });
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      draw: (context, width, height) => context.drawImage(image, 0, 0, width, height),
      close: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

/** 圖片上傳一律先縮圖再存進 localStorage：避免單張圖片就把容量塞爆。 */
export async function resizeImageToDataUrl(file: File, maxWidth = 800, quality = 0.7): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("請選擇圖片檔案");
  if (file.size > 15 * 1024 * 1024) throw new Error("圖片檔案過大，上限 15MB");
  const image = await decodeUploadImage(file);
  try {
    const scale = Math.min(1, maxWidth / image.width);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("這個瀏覽器不支援圖片處理");
    image.draw(context, width, height);
    let currentQuality = quality;
    let dataUrl = canvas.toDataURL("image/jpeg", currentQuality);
    while (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH && currentQuality > 0.3) {
      currentQuality -= 0.15;
      dataUrl = canvas.toDataURL("image/jpeg", currentQuality);
    }
    if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) throw new Error("圖片處理後仍太大，請換一張較小的圖片");
    return dataUrl;
  } finally {
    image.close();
  }
}
