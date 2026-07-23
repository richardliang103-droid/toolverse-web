import { AutoModel, AutoProcessor, RawImage } from "@huggingface/transformers";

type WorkerRequest = { type: "remove"; file: File };

// RMBG-1.4 是通用去背模型（Xenova/modnet 是人像專用，一般物品/商品照效果差很多），
// 但沒有現成的 "background-removal" pipeline 包裝，要自己跑 model+processor
// 再手動把 mask 合成到原圖的 alpha 上。
const MODEL_ID = "briaai/RMBG-1.4";

function reportProgress(data: { status?: string; progress?: number; file?: string }) {
  if (data.status !== "progress" || typeof data.progress !== "number") return;
  const stage = data.file?.includes("model") ? "正在下載本機 AI 模型" : "正在準備模型檔案";
  self.postMessage({ type: "progress", progress: Math.max(0, Math.min(100, data.progress)), stage });
}

async function buildEngine(device: "webgpu" | "wasm", dtype: "fp32" | "q8") {
  const model = await AutoModel.from_pretrained(MODEL_ID, { device, dtype, progress_callback: reportProgress });
  const processor = await AutoProcessor.from_pretrained(MODEL_ID);
  return {
    async remover(file: File) {
      const image = await RawImage.fromBlob(file);
      const { pixel_values } = await processor(image);
      const { output } = await model({ input: pixel_values });
      const maskTensor = output.squeeze(0).mul(255).clamp(0, 255).to("uint8");
      const mask = await RawImage.fromTensor(maskTensor).resize(image.width, image.height);
      const rgba = image.rgba();
      rgba.putAlpha(mask);
      return rgba;
    },
  };
}

async function createEngine(forceWasm = false) {
  const canUseWebGPU = !forceWasm && typeof navigator !== "undefined" && "gpu" in navigator;
  if (canUseWebGPU) {
    try {
      const engine = await buildEngine("webgpu", "fp32");
      return { ...engine, backend: "WebGPU" as const };
    } catch {
      // Some devices expose WebGPU but cannot run this model; WASM is the safe fallback.
    }
  }
  const engine = await buildEngine("wasm", "q8");
  return { ...engine, backend: "WASM" as const };
}

let enginePromise: ReturnType<typeof createEngine> | null = null;
function getEngine(forceWasm = false) {
  if (forceWasm || !enginePromise) {
    // If model setup fails (e.g. a transient network hiccup while downloading
    // the model), forget the cached promise so the next attempt actually
    // retries instead of instantly re-throwing the same stale rejection.
    enginePromise = createEngine(forceWasm).catch((error) => {
      enginePromise = null;
      throw error;
    });
  }
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
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    // AI 模型與 WASM 執行檔會從 huggingface.co／jsdelivr 下載；"Failed to fetch" 代表
    // 連不到這些服務（網路限制、防火牆），跟圖片本身無關，「換一張圖片」對此無效。
    const isNetworkFailure = error instanceof TypeError && /fetch/i.test(error.message);
    const code = /InvalidStateError|could not be decoded|unusable/i.test(detail)
      ? "decode"
      : error instanceof Error && /memory|allocation/i.test(error.message)
        ? "memory"
        : isNetworkFailure
          ? "network"
          : "unknown";
    const message = {
      decode: "瀏覽器無法解碼這張圖片",
      memory: "裝置記憶體不足，請改用尺寸較小的圖片",
      network: "無法連線到本機 AI 模型伺服器（Hugging Face／CDN），可能是網路限制或防火牆阻擋，跟這張圖片無關。可以重新整理後再試一次，或改用下方的 remove.bg 模式。",
      unknown: "本機去背失敗，請重新整理後再試",
    }[code];
    self.postMessage({ type: "error", message, detail, code });
  }
};
