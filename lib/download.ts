/**
 * 觸發瀏覽器下載。
 *
 * 刻意跟 `download-zip.ts` 分開：那個檔案為了打包 ZIP 會拉進 fflate，而大部分
 * 需要下載的地方（例如工作區）根本不打包，不該為了一個 `<a download>` 就把
 * 壓縮程式庫也載進來。
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // 立刻 revoke 會讓部分瀏覽器來不及開始下載；延遲之後一定要收回，否則這個
  // Blob 會被 Object URL 一直參照著，直到整個分頁關掉才釋放。
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
