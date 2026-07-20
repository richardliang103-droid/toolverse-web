import { Renderer } from "marked";

const CONTROL_OR_WHITESPACE = /[\u0000-\u0020\u007f-\u009f]/g;

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 只允許 Markdown 連結使用網頁、郵件、電話或站內相對路徑。 */
export function safeMarkdownUrl(value: string | null | undefined, kind: "link" | "image" = "link") {
  if (!value) return null;
  const normalized = value.replace(CONTROL_OR_WHITESPACE, "");
  if (normalized.startsWith("#") || normalized.startsWith("/") || normalized.startsWith("?")) return normalized;
  try {
    const protocol = new URL(normalized).protocol.toLowerCase();
    if (protocol === "https:" || protocol === "http:") return normalized;
    if (kind === "link" && (protocol === "mailto:" || protocol === "tel:")) return normalized;
  } catch { /* 非完整 URL 視為不安全，避免瀏覽器猜測協定。 */ }
  return null;
}

/** Marked 不會自行清理 javascript: URL；輸出前改用受限 renderer。 */
export function createSafeMarkdownRenderer() {
  const renderer = new Renderer();
  renderer.link = function ({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    const safeHref = safeMarkdownUrl(href, "link");
    if (!safeHref) return text;
    return `<a href="${escapeAttribute(safeHref)}"${title ? ` title="${escapeAttribute(title)}"` : ""} rel="noopener noreferrer">${text}</a>`;
  };
  renderer.image = function ({ href, title, text }) {
    const safeHref = safeMarkdownUrl(href, "image");
    if (!safeHref) return escapeAttribute(text);
    return `<img src="${escapeAttribute(safeHref)}" alt="${escapeAttribute(text)}"${title ? ` title="${escapeAttribute(title)}"` : ""}>`;
  };
  return renderer;
}
