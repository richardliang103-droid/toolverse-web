/**
 * 把 Float32 PCM 聲道編碼成 16-bit WAV（RIFF）ArrayBuffer。
 * 無損、無外部依賴；音訊剪輯工具的匯出走這裡。
 */
export function encodeWavPcm16(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const channelCount = Math.max(1, channels.length);
  const frameCount = channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = frameCount * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel]?.[frame] ?? 0));
      view.setInt16(offset, Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), true);
      offset += bytesPerSample;
    }
  }
  return buffer;
}

/** 秒數顯示：mm:ss.s */
export function formatSeconds(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const minutes = Math.floor(clamped / 60);
  const rest = clamped - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(1).padStart(4, "0")}`;
}

/** 修剪範圍防呆：0 ≤ start < end ≤ duration，保留至少 0.1 秒（整段不到 0.1
 *  秒的極短音檔則保留整段，不能為了湊滿 0.1 秒而讓 end 超過 duration）。
 *  畫面上的輸入框／滑桿一律用未四捨五入的原始 duration 當 max，所以這裡
 *  的夾限運算也對原始 duration 做，不能先把 duration 本身四捨五入掉——
 *  否則極短音檔（例如 0.03 秒）會被四捨五入成 0.0，start 與 end 一起被壓成
 *  同一個數字，變成「長度 0」的裁切範圍，違反 start < end 這個不變量。
 *  一般情況維持跟畫面 mm:ss.s 顯示一致的 1 位小數；只有整段音檔短於 0.1 秒
 *  這個 1 位小數本身就不夠表示的極端情況，才改用更細的精度確保 start < end
 *  仍然成立。 */
export function clampTrimRange(start: number, end: number, duration: number): { start: number; end: number } {
  const safeDuration = Math.max(0, duration);
  const minWindow = Math.min(0.1, safeDuration);
  const safeStart = Math.min(Math.max(0, start), Math.max(0, safeDuration - minWindow));
  const safeEnd = Math.max(safeStart + minWindow, Math.min(end, safeDuration));
  const precision = safeDuration < 0.1 ? 3 : 1;
  return { start: Number(safeStart.toFixed(precision)), end: Number(safeEnd.toFixed(precision)) };
}
