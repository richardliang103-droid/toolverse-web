import { pipeline } from "@huggingface/transformers";

type WorkerRequest = { type: "remove"; file: File };

function reportProgress(data: { status?: string; progress?: number; file?: string }) {
  if (data.status !== "progress" || typeof data.progress !== "number") return;
  const stage = data.file?.includes("model") ? "正在下載本機 AI 模型" : "正在準備模型檔案";
  self.postMessage({ type: "progress", progress: Math.max(0, Math.min(100, data.progress)), stage });
}

async function createEngine(forceWasm = false) {
  const canUseWebGPU = !forceWasm && typeof navigator !== "undefined" && "gpu" in navigator;
  if (canUseWebGPU) {
    try {
      const remover = await pipeline("background-removal", "Xenova/modnet", { device: "webgpu", dtype: "fp32", progress_callback: reportProgress });
      return { remover, backend: "WebGPU" as const };
    } catch {
      // Some devices expose WebGPU but cannot run this model; WASM is the safe fallback.
    }
  }
  const remover = await pipeline("background-removal", "Xenova/modnet", { device: "wasm", dtype: "q8", progress_callback: reportProgress });
  return { remover, backend: "WASM" as const };
}

let enginePromise: ReturnType<typeof createEngine> | null = null;
function getEngine(forceWasm = false) {
  if (forceWasm || !enginePromise) enginePromise = createEngine(forceWasm);
  return enginePromise;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type !== "remove") return;
  try {
    let engine = await getEngine();
    self.postMessage({ type: "ready", backend: engine.backend });
    let output;
    try {
      output = await engine.remover(event.data.file);
    } catch (error) {
      if (engine.backend !== "WebGPU") throw error;
      engine = await getEngine(true);
      self.postMessage({ type: "ready", backend: engine.backend });
      output = await engine.remover(event.data.file);
    }
    const blob = await output.toBlob("image/png");
    self.postMessage({ type: "result", blob, backend: engine.backend });
  } catch (error) {
    const message = error instanceof Error && /memory|allocation/i.test(error.message)
      ? "裝置記憶體不足，請改用尺寸較小的圖片"
      : "本機去背失敗，請確認網路連線或換一張圖片再試";
    self.postMessage({ type: "error", message });
  }
};
