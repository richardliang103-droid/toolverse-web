import {
  strFromU8,
  strToU8,
  unzip,
  zip,
  type AsyncUnzipOptions,
  type AsyncZippable,
  type Unzipped,
} from "fflate";
import {
  sanitizePersonalToolsState,
  type PersonalToolsState,
} from "./personal-tools.ts";
import { safeFileName } from "./workspace/naming.ts";
import type { WorkspaceRepository } from "./workspace/repository.ts";
import type { WorkspaceItem } from "./workspace/types.ts";

export const PERSONAL_BACKUP_FORMAT = "toolverse-backup";
export const PERSONAL_BACKUP_VERSION = 1;
export const MAX_BACKUP_ITEMS = 250;
export const MAX_BACKUP_BYTES = 512 * 1024 * 1024;

const MANIFEST_PATH = "manifest.json";
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_ENTRIES = 50;
const MAX_METADATA_STRING_LENGTH = 4096;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface BackupWorkspaceManifestItem {
  backupId: string;
  path: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  sourceTool: string | null;
  createdAt: string;
  pinned: boolean;
  metadata: Record<string, JsonValue>;
}

interface BackupManifest {
  format: typeof PERSONAL_BACKUP_FORMAT;
  version: typeof PERSONAL_BACKUP_VERSION;
  exportedAt: string;
  personalTools: PersonalToolsState;
  workspace: BackupWorkspaceManifestItem[];
}

export interface PersonalBackupSource {
  item: Pick<WorkspaceItem, "id" | "name" | "mimeType" | "sourceTool" | "createdAt" | "pinned" | "metadata">;
  blob: Blob;
}

export interface PersonalBackupWorkspaceFile extends BackupWorkspaceManifestItem {
  blob: Blob;
}

export interface ParsedPersonalBackup {
  exportedAt: string;
  personalTools: PersonalToolsState;
  workspace: PersonalBackupWorkspaceFile[];
  totalBytes: number;
}

type PersonalBackupRepository = Pick<WorkspaceRepository, "list" | "read" | "save" | "remove">;

export class PersonalBackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonalBackupError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeJsonValue(value: unknown, depth: number): JsonValue | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return value.slice(0, MAX_METADATA_STRING_LENGTH);
  if (depth >= MAX_METADATA_DEPTH) return undefined;
  if (Array.isArray(value)) {
    const result: JsonValue[] = [];
    for (const entry of value.slice(0, MAX_METADATA_ENTRIES)) {
      const safe = safeJsonValue(entry, depth + 1);
      if (safe !== undefined) result.push(safe);
    }
    return result;
  }
  if (!isRecord(value)) return undefined;
  const result: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value).slice(0, MAX_METADATA_ENTRIES)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const safe = safeJsonValue(entry, depth + 1);
    if (safe !== undefined) result[key.slice(0, 100)] = safe;
  }
  return result;
}

function safeMetadata(value: unknown): Record<string, JsonValue> {
  const safe = safeJsonValue(value, 0);
  return isRecord(safe) ? safe as Record<string, JsonValue> : {};
}

function validIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function safeSourceTool(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value) ? value : null;
}

function safeMimeType(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" && value.length <= 200 && !/[\r\n]/.test(value)
    ? value
    : "application/octet-stream";
}

function safeBackupName(value: unknown): string {
  const rawName = (typeof value === "string" ? value : "未命名檔案")
    .replace(/[\u0000-\u001f\u007f]/g, "");
  const name = safeFileName(rawName).trim();
  return name.slice(0, 240) || "未命名檔案";
}

function zipArchive(files: AsyncZippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try {
      zip(files, { level: 6 }, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function unzipArchive(data: Uint8Array, options: AsyncUnzipOptions): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    try {
      unzip(data, options, (error, files) => {
        if (error) reject(error);
        else resolve(files);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function blobFromBytes(bytes: Uint8Array, type: string): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type });
}

function manifestItem(raw: unknown): BackupWorkspaceManifestItem {
  if (!isRecord(raw)) throw new PersonalBackupError("備份檔的工作區清單損壞，無法匯入。");
  const backupId = typeof raw.backupId === "string" && raw.backupId.trim() !== "" && raw.backupId.length <= 128
    ? raw.backupId
    : null;
  const path = typeof raw.path === "string" && /^files\/[a-zA-Z0-9_-]{1,80}$/.test(raw.path)
    ? raw.path
    : null;
  const sizeBytes = typeof raw.sizeBytes === "number" && Number.isSafeInteger(raw.sizeBytes) && raw.sizeBytes >= 0
    ? raw.sizeBytes
    : null;
  const createdAt = validIsoDate(raw.createdAt);
  if (!backupId || !path || sizeBytes === null || !createdAt) {
    throw new PersonalBackupError("備份檔的工作區清單損壞，無法匯入。");
  }
  return {
    backupId,
    path,
    name: safeBackupName(raw.name),
    mimeType: safeMimeType(raw.mimeType),
    sizeBytes,
    sourceTool: safeSourceTool(raw.sourceTool),
    createdAt,
    pinned: raw.pinned === true,
    metadata: safeMetadata(raw.metadata),
  };
}

export function parsePersonalBackupManifest(
  raw: unknown,
  validSlugs: readonly string[],
): Omit<ParsedPersonalBackup, "workspace"> & { workspace: BackupWorkspaceManifestItem[] } {
  if (!isRecord(raw) || raw.format !== PERSONAL_BACKUP_FORMAT) {
    throw new PersonalBackupError("這不是 ToolVerse 備份檔，請選擇先前匯出的 ZIP。");
  }
  if (raw.version !== PERSONAL_BACKUP_VERSION) {
    throw new PersonalBackupError("這份備份版本不相容，請先更新 ToolVerse 再匯入。");
  }
  const exportedAt = validIsoDate(raw.exportedAt);
  if (!exportedAt || !Array.isArray(raw.workspace)) {
    throw new PersonalBackupError("備份檔損壞或格式不完整，無法匯入。");
  }
  if (raw.workspace.length > MAX_BACKUP_ITEMS) {
    throw new PersonalBackupError(`備份超過 ${MAX_BACKUP_ITEMS} 個工作區項目的安全上限，請分批備份。`);
  }

  const workspace = raw.workspace.map(manifestItem);
  const ids = new Set<string>();
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const item of workspace) {
    if (ids.has(item.backupId) || paths.has(item.path)) {
      throw new PersonalBackupError("備份檔含有重複的工作區項目，無法安全匯入。");
    }
    ids.add(item.backupId);
    paths.add(item.path);
    totalBytes += item.sizeBytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_BACKUP_BYTES) {
      throw new PersonalBackupError("備份解壓後超過 512 MB 的安全上限，請分批備份。");
    }
  }

  return {
    exportedAt,
    personalTools: sanitizePersonalToolsState(raw.personalTools, validSlugs),
    workspace,
    totalBytes,
  };
}

/** 建立單一 ZIP；資料直接在瀏覽器記憶體中打包，不會傳到伺服器。 */
export async function createPersonalBackupArchive(
  personalTools: PersonalToolsState,
  workspace: readonly PersonalBackupSource[],
  validSlugs: readonly string[],
  exportedAt = new Date(),
): Promise<Blob> {
  if (workspace.length > MAX_BACKUP_ITEMS) {
    throw new PersonalBackupError(`工作區超過 ${MAX_BACKUP_ITEMS} 個項目的備份上限，請先整理後再重試。`);
  }

  const files: AsyncZippable = {};
  const manifestItems: BackupWorkspaceManifestItem[] = [];
  let totalBytes = 0;
  for (const [index, source] of workspace.entries()) {
    totalBytes += source.blob.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_BACKUP_BYTES) {
      throw new PersonalBackupError("工作區超過 512 MB 的備份上限，請先整理後再重試。");
    }
    const path = `files/${String(index + 1).padStart(6, "0")}`;
    files[path] = new Uint8Array(await source.blob.arrayBuffer());
    manifestItems.push({
      backupId: source.item.id,
      path,
      name: safeBackupName(source.item.name),
      mimeType: safeMimeType(source.item.mimeType || source.blob.type),
      sizeBytes: source.blob.size,
      sourceTool: safeSourceTool(source.item.sourceTool),
      createdAt: validIsoDate(source.item.createdAt) ?? exportedAt.toISOString(),
      pinned: source.item.pinned,
      metadata: safeMetadata(source.item.metadata),
    });
  }

  const manifest: BackupManifest = {
    format: PERSONAL_BACKUP_FORMAT,
    version: PERSONAL_BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    personalTools: sanitizePersonalToolsState(personalTools, validSlugs),
    workspace: manifestItems,
  };
  const manifestBytes = strToU8(JSON.stringify(manifest, null, 2));
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
    throw new PersonalBackupError("工作區的中繼資料過多，無法建立安全的備份。");
  }
  files[MANIFEST_PATH] = manifestBytes;

  try {
    return blobFromBytes(await zipArchive(files), "application/zip");
  } catch {
    throw new PersonalBackupError("建立備份失敗，請關閉其他大型分頁後再重試。");
  }
}

/** 從 repository 收齊 Blob；任一項目失效就停止，避免產生看似成功但缺檔的備份。 */
export async function collectPersonalBackupSources(
  repository: Pick<PersonalBackupRepository, "list" | "read">,
): Promise<PersonalBackupSource[]> {
  const items = await repository.list();
  const sources: PersonalBackupSource[] = [];
  for (const item of items) {
    const blob = await repository.read(item.id);
    if (!blob) {
      throw new PersonalBackupError(`找不到「${item.name}」的檔案內容，請先刪除這個失效項目再備份。`);
    }
    sources.push({ item, blob });
  }
  return sources;
}

/** 批次匯入失敗時移除這一批已新增的項目，不動使用者原本的 Workspace。 */
export async function restorePersonalBackupWorkspace(
  repository: Pick<PersonalBackupRepository, "save" | "remove">,
  workspace: readonly PersonalBackupWorkspaceFile[],
): Promise<number> {
  const savedIds: string[] = [];
  try {
    for (const entry of workspace) {
      const item = await repository.save({
        name: entry.name,
        blob: entry.blob,
        mimeType: entry.mimeType,
        sourceTool: entry.sourceTool,
        metadata: entry.metadata,
        pinned: entry.pinned,
        createdAt: entry.createdAt,
      });
      savedIds.push(item.id);
    }
  } catch (error) {
    await Promise.all(savedIds.map((id) => repository.remove(id).catch(() => false)));
    throw error;
  }
  return savedIds.length;
}

/** 先只讀 manifest，再依白名單解壓內容；不會把 ZIP 裡的任意路徑寫入檔案系統。 */
export async function readPersonalBackupArchive(
  archive: Blob,
  validSlugs: readonly string[],
): Promise<ParsedPersonalBackup> {
  if (archive.size > MAX_BACKUP_BYTES) {
    throw new PersonalBackupError("備份檔超過 512 MB 的安全上限，無法匯入。");
  }

  const data = new Uint8Array(await archive.arrayBuffer());
  let manifestMatches = 0;
  let manifestFiles: Unzipped;
  try {
    manifestFiles = await unzipArchive(data, {
      filter(info) {
        if (info.name !== MANIFEST_PATH) return false;
        manifestMatches += 1;
        if (manifestMatches > 1 || info.originalSize > MAX_MANIFEST_BYTES) {
          throw new PersonalBackupError("備份清單異常，無法安全匯入。");
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof PersonalBackupError) throw error;
    throw new PersonalBackupError("備份檔損壞或不是有效的 ZIP。");
  }

  const manifestBytes = manifestFiles[MANIFEST_PATH];
  if (!manifestBytes) throw new PersonalBackupError("這不是 ToolVerse 備份檔，請選擇先前匯出的 ZIP。");

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(strFromU8(manifestBytes));
  } catch {
    throw new PersonalBackupError("備份清單不是有效的 JSON，無法匯入。");
  }
  const manifest = parsePersonalBackupManifest(rawManifest, validSlugs);
  if (manifest.workspace.length === 0) return { ...manifest, workspace: [] };

  const expected = new Map(manifest.workspace.map((item) => [item.path, item.sizeBytes]));
  const seen = new Set<string>();
  let extractedBytes = 0;
  let extracted: Unzipped;
  try {
    extracted = await unzipArchive(data, {
      filter(info) {
        const expectedSize = expected.get(info.name);
        if (expectedSize === undefined) return false;
        if (seen.has(info.name) || info.originalSize !== expectedSize) {
          throw new PersonalBackupError("備份檔案大小或路徑與清單不符，無法安全匯入。");
        }
        seen.add(info.name);
        extractedBytes += info.originalSize;
        if (extractedBytes > MAX_BACKUP_BYTES) {
          throw new PersonalBackupError("備份解壓後超過 512 MB 的安全上限，無法匯入。");
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof PersonalBackupError) throw error;
    throw new PersonalBackupError("備份內容損壞，無法匯入。");
  }

  const workspace = manifest.workspace.map((item) => {
    const bytes = extracted[item.path];
    if (!bytes || bytes.byteLength !== item.sizeBytes) {
      throw new PersonalBackupError(`備份缺少「${item.name}」的檔案內容。`);
    }
    return { ...item, blob: blobFromBytes(bytes, item.mimeType) };
  });
  return { ...manifest, workspace };
}

export function personalBackupFileName(date = new Date()): string {
  return `toolverse-backup-${date.toISOString().slice(0, 10)}.zip`;
}
