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

/** 修剪範圍防呆：0 ≤ start < end ≤ duration，保留至少 0.1 秒。 */
export function clampTrimRange(start: number, end: number, duration: number): { start: number; end: number } {
  const safeStart = Math.min(Math.max(0, start), Math.max(0, duration - 0.1));
  const safeEnd = Math.max(safeStart + 0.1, Math.min(end, duration));
  return { start: Number(safeStart.toFixed(1)), end: Number(safeEnd.toFixed(1)) };
}
