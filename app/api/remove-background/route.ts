import { NextResponse } from "next/server";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  try {
    const incoming = await request.formData();
    const image = incoming.get("image");
    if (!(image instanceof File)) return NextResponse.json({ error: "沒有收到圖片" }, { status: 400 });
    if (!ALLOWED_TYPES.has(image.type)) return NextResponse.json({ error: "只支援 JPG、PNG 與 WebP" }, { status: 415 });
    if (image.size > MAX_FILE_SIZE) return NextResponse.json({ error: "圖片大小不能超過 10 MB" }, { status: 413 });

    const apiKey = process.env.REMOVE_BG_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "去背服務尚未啟用，請稍後再試" }, { status: 503 });

    const outgoing = new FormData(); outgoing.append("image_file", image); outgoing.append("size", "auto"); outgoing.append("format", "png");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    const response = await fetch("https://api.remove.bg/v1.0/removebg", { method: "POST", headers: { "X-Api-Key": apiKey }, body: outgoing, signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      const status = response.status === 402 || response.status === 429 ? 429 : 502;
      return NextResponse.json({ error: status === 429 ? "今日去背額度已用完，請稍後再試" : "去背服務暫時無法處理這張圖片" }, { status });
    }
    return new Response(await response.arrayBuffer(), { status: 200, headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "Content-Disposition": "attachment; filename=hermes-background-removed.png" } });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "處理時間過久，請換一張較小的圖片" : "處理圖片時發生錯誤";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
