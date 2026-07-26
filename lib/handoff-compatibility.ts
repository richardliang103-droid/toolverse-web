import type { ToolInputCapability, ToolManifest } from "./tool-manifest.ts";

export interface HandoffFileDescriptor {
  mimeType: string;
  extension: string | null;
  sizeBytes: number;
}

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot).toLowerCase() : null;
}

export function describeHandoffFile(file: Pick<File, "name" | "size" | "type">): HandoffFileDescriptor {
  return {
    mimeType: file.type,
    extension: extensionOf(file.name),
    sizeBytes: file.size,
  };
}

function acceptsFile(input: ToolInputCapability, file: HandoffFileDescriptor): boolean {
  if (input.kind !== "file") return false;
  if (input.maxSizeBytes !== undefined && file.sizeBytes > input.maxSizeBytes) return false;
  const mime = file.mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  const mimeAccepted = mime !== "" && (input.mimeTypes?.includes(mime) ?? false);
  const extensionAccepted = file.extension !== null && (input.extensions?.includes(file.extension.toLowerCase()) ?? false);
  return mimeAccepted || extensionAccepted;
}

/** 接力目的地必須能一次接下整批內容，而不是只有代表項目相容。 */
export function acceptsHandoffFiles(
  manifest: ToolManifest,
  files: readonly HandoffFileDescriptor[],
): boolean {
  if (files.length === 0) return false;
  if (!manifest.handoff.canReceive || !manifest.handoff.kinds.includes("file")) return false;
  if (files.length > 1 && !manifest.supportsBatch) return false;
  return manifest.inputs.some((input) => {
    if (input.kind !== "file") return false;
    if (input.maxFiles !== undefined && files.length > input.maxFiles) return false;
    return files.every((file) => acceptsFile(input, file));
  });
}
