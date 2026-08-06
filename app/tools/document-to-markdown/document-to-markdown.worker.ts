import init, { toMarkdownBytes } from "@firecrawl/anydoc-wasm";
import { documentFormatForFilename, type AnyDocFormat } from "@/lib/document-to-markdown";

type ConvertRequest = {
  type: "convert";
  name: string;
  bytes: ArrayBuffer;
};

type WorkerResponse =
  | { type: "ready" }
  | { type: "success"; name: string; markdown: string }
  | { type: "error"; name: string; code?: string; message?: string };

let initialized: Promise<void> | null = null;

function ensureInitialized() {
  initialized ??= init().then(() => undefined);
  return initialized;
}

self.addEventListener("message", (event: MessageEvent<ConvertRequest>) => {
  if (event.data.type !== "convert") return;
  void convert(event.data);
});

async function convert(request: ConvertRequest) {
  try {
    await ensureInitialized();
    const format = documentFormatForFilename(request.name) as AnyDocFormat | undefined;
    const markdown = toMarkdownBytes(new Uint8Array(request.bytes), format ?? undefined);
    self.postMessage({ type: "success", name: request.name, markdown } satisfies WorkerResponse);
  } catch (caught) {
    const error = caught as { code?: string; message?: string };
    self.postMessage({
      type: "error",
      name: request.name,
      code: error.code,
      message: error.message,
    } satisfies WorkerResponse);
  }
}
