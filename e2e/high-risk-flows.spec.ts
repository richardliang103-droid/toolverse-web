import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

function jpegSegment(marker: number, payload: number[]) {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
}

/** 結構正確、帶 EXIF 的最小 JPEG segment 流；EXIF 工具不重編碼影像，不需要解碼。 */
function metadataJpeg() {
  const bytes = [0xff, 0xd8];
  bytes.push(...jpegSegment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00]));
  bytes.push(...jpegSegment(0xe1, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 1, 2, 3, 4]));
  bytes.push(...jpegSegment(0xdb, [0x01, 0x02]));
  bytes.push(0xff, 0xda, 0x00, 0x04, 0x00, 0x00, 0xaa, 0xbb, 0xcc, 0xff, 0xd9);
  return Buffer.from(bytes);
}

async function singlePagePdf() {
  const document = await PDFDocument.create();
  document.addPage([100, 100]);
  return Buffer.from(await document.save());
}

test("EXIF 清除器連續加入兩批照片時，會保留上限內的 20 張", async ({ page }) => {
  await page.goto("/tools/exif-cleaner");
  const input = page.getByLabel("選擇要清除隱私資訊的照片");
  const firstBatch = Array.from({ length: 12 }, (_, index) => ({ name: `first-${index}.jpg`, mimeType: "image/jpeg", buffer: metadataJpeg() }));
  const secondBatch = Array.from({ length: 12 }, (_, index) => ({ name: `second-${index}.jpg`, mimeType: "image/jpeg", buffer: metadataJpeg() }));

  await input.setInputFiles(firstBatch);
  await input.setInputFiles(secondBatch);

  await expect(page.getByRole("heading", { name: "已處理 20 張照片" })).toBeVisible();
  await expect(page.getByText("其餘 4 張未處理（上限 20 張）")).toBeVisible();
  await expect(page.locator(".compressor-list > li")).toHaveCount(20);
  await expect(page.getByText(/移除了 EXIF/).first()).toBeVisible();
});

test("PDF 換檔時，較慢的舊檔錯誤不會清掉已載入的新檔", async ({ page }) => {
  await page.addInitScript(() => {
    const originalArrayBuffer = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function delayedOldPdf(this: File) {
      return originalArrayBuffer.call(this).then((buffer) => (
        this.name === "old-invalid.pdf"
          ? new Promise<ArrayBuffer>((resolve) => window.setTimeout(() => resolve(buffer), 250))
          : buffer
      ));
    };
  });
  await page.goto("/tools/pdf-toolkit");
  await page.getByRole("button", { name: "取出指定頁面" }).click();
  const input = page.getByLabel("選擇要取頁的 PDF");

  await input.setInputFiles({ name: "old-invalid.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a PDF") });
  await input.setInputFiles({ name: "new-valid.pdf", mimeType: "application/pdf", buffer: await singlePagePdf() });

  await expect(page.getByRole("button", { name: "已選：new-valid.pdf" })).toBeVisible();
  await expect(page.getByText("共 1 頁")).toBeVisible();
  await expect(page.getByRole("alert")).not.toBeVisible();
});

test("圖片壓縮完成後修改品質，會重新排入處理並可再次完成", async ({ page }) => {
  await page.goto("/tools/image-compressor");
  await page.getByLabel("選擇要壓縮的圖片").evaluate((element) => new Promise<void>((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    canvas.getContext("2d")?.fillRect(0, 0, 2, 2);
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error("無法建立測試圖片")); return; }
      const input = element as HTMLInputElement;
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], "retry.png", { type: "image/png" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      resolve();
    }, "image/png");
  }));

  await page.getByRole("button", { name: "開始壓縮" }).click();
  await expect(page.getByText("1/1 完成")).toBeVisible();

  await page.locator("#compress-quality").fill("55");
  await expect(page.getByText("1 張待處理")).toBeVisible();
  await page.getByRole("button", { name: "開始壓縮" }).click();
  await expect(page.getByText("1/1 完成")).toBeVisible();
});

test("音訊檔超過 30 MB 時，在解碼前顯示安全上限錯誤", async ({ page }) => {
  await page.goto("/tools/audio-trimmer");
  await page.getByLabel("選擇剪輯音訊檔").evaluate((element) => {
    const input = element as HTMLInputElement;
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(30 * 1024 * 1024 + 1)], "too-large.wav", { type: "audio/wav" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await expect(page.getByRole("alert")).toHaveText("單一檔案超過 30 MB 上限");
});

test("Service Worker 在離線且沒有快取的導覽時回傳離線頁", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.goto("/e2e-not-cached-while-offline", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "目前無法連線" })).toBeVisible();
  await expect(page.getByRole("link", { name: "回到工具首頁" })).toHaveAttribute("href", "/");
});
