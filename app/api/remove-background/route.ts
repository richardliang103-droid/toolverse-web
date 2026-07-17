import { NextRequest, NextResponse } from "next/server";

// remove.bg's API does not support being called directly from a browser
// (no CORS headers for cross-origin requests), so this route relays the
// request server-side. The API key comes from the request itself (typed by
// the user into the page) and is only ever forwarded for this one request —
// it is never logged, stored, or written anywhere.
export const runtime = "nodejs";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SIZE = 10 * 1024 * 1024;

// 輕量 in-memory 頻率限制：這條 route 會轉送到付費的 remove.bg，避免單一
// 來源灌爆。每個執行個體各自計數（serverless 下非全域），足以擋住暴力濫用。
const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 60_000;
const requestLog = new Map<string, number[]>();

function isRateLimited(clientId: string) {
  const now = Date.now();
  if (requestLog.size > 1000) {
    for (const [key, hits] of requestLog) {
      if (hits.every((time) => now - time >= RATE_WINDOW_MS)) requestLog.delete(key);
    }
  }
  const recent = (requestLog.get(clientId) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) { requestLog.set(clientId, recent); return true; }
  recent.push(now);
  requestLog.set(clientId, recent);
  return false;
}

export async function POST(request: NextRequest) {
  const clientId = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(clientId)) {
    return NextResponse.json({ error: "請求太頻繁，請稍後再試" }, { status: 429 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const apiKey = form.get("apiKey");
  const image = form.get("image");

  if (typeof apiKey !== "string" || apiKey.trim().length < 10) {
    return NextResponse.json({ error: "請輸入有效的 remove.bg API 金鑰" }, { status: 400 });
  }
  if (!(image instanceof File)) {
    return NextResponse.json({ error: "請選擇要去背的圖片" }, { status: 400 });
  }
  const acceptableType = ALLOWED_TYPES.has(image.type) || (image.type === "" && /\.(jpe?g|png|webp)$/i.test(image.name));
  if (!acceptableType) {
    return NextResponse.json({ error: "只支援 JPG、PNG 與 WebP 圖片" }, { status: 400 });
  }
  if (image.size > MAX_SIZE) {
    return NextResponse.json({ error: "圖片大小不能超過 10 MB" }, { status: 400 });
  }

  try {
    const upstreamForm = new FormData();
    upstreamForm.set("image_file", image, image.name || "image");
    upstreamForm.set("size", "auto");

    const response = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": apiKey.trim() },
      body: upstreamForm,
    });

    if (!response.ok) {
      let message = `remove.bg 服務暫時無法使用（${response.status}）`;
      try {
        const data = (await response.json()) as { errors?: Array<{ title?: string; detail?: string }> };
        const first = data.errors?.[0];
        if (first) message = first.detail || first.title || message;
      } catch {
        // remove.bg sometimes returns a non-JSON body on error; fall back to the generic message.
      }
      const status = response.status === 429 ? 429 : response.status === 402 ? 402 : 502;
      return NextResponse.json({ error: message }, { status });
    }

    const buffer = await response.arrayBuffer();
    return new NextResponse(buffer, {
      status: 200,
      headers: { "Content-Type": response.headers.get("Content-Type") || "image/png" },
    });
  } catch {
    return NextResponse.json({ error: "無法連上 remove.bg，請稍後再試" }, { status: 502 });
  }
}
