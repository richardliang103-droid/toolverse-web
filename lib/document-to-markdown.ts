export const SUPPORTED_DOCUMENT_EXTENSIONS = [
  ".doc", ".docm", ".docx",
  ".epub",
  ".pdf",
  ".pot", ".potm", ".pps", ".ppsm", ".ppsx", ".ppt", ".pptm", ".pptx",
  ".rtf",
  ".csv",
  ".ods", ".odp", ".odt",
  ".xls", ".xlsb", ".xlsm", ".xlsx",
] as const;

const SUPPORTED_EXTENSION_SET = new Set<string>(SUPPORTED_DOCUMENT_EXTENSIONS);

export type AnyDocError = { code?: string };
export type AnyDocFormat = "doc" | "docx" | "odt" | "pdf" | "ppt" | "pptx" | "rtf" | "epub" | "xlsx" | "ods" | "odp" | "csv";

export function documentFormatForFilename(name: string): AnyDocFormat | undefined {
  const extension = name.includes(".") ? `.${name.split(".").pop()!.toLowerCase()}` : "";
  if (extension === ".csv") return "csv";
  if ([".doc", ".docm"].includes(extension)) return "doc";
  if (extension === ".docx") return "docx";
  if (extension === ".odt") return "odt";
  if (extension === ".pdf") return "pdf";
  if ([".ppt", ".pot", ".pps"].includes(extension)) return "ppt";
  if ([".pptx", ".potm", ".ppsx", ".pptm", ".ppsm"].includes(extension)) return "pptx";
  if (extension === ".rtf") return "rtf";
  if (extension === ".epub") return "epub";
  if ([".xls", ".xlsx", ".xlsm", ".xlsb"].includes(extension)) return "xlsx";
  if (extension === ".ods") return "ods";
  if (extension === ".odp") return "odp";
  return undefined;
}

export function isSupportedDocument(file: Pick<File, "name" | "type">) {
  const extension = file.name.includes(".") ? `.${file.name.split(".").pop()!.toLowerCase()}` : "";
  return SUPPORTED_EXTENSION_SET.has(extension);
}

export function documentMarkdownFilename(name: string) {
  const withoutExtension = name.replace(/\.[^.]*$/, "");
  return `${withoutExtension || "document"}.md`;
}

export function userFacingConversionError(error: AnyDocError) {
  switch (error.code) {
    case "unsupported":
      return "這份檔案格式不支援，或沒有可擷取的文字內容。掃描 PDF 需要 OCR。";
    case "encrypted":
      return "檔案有密碼或已加密，無法轉換。";
    case "resourceLimit":
      return "檔案結構或大小超過安全限制，請改用較小的檔案。";
    case "malformed":
    case "missingPart":
      return "檔案結構不完整或已損壞，請確認檔案可以正常開啟。";
    default:
      return "轉換失敗，請確認檔案沒有損壞或改用其他格式。";
  }
}
