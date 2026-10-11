/**
 * The content-addressed file store: receipts (GitLab #82) and listing photos
 * (GitLab #106) share it. Server-side only.
 *
 * - Files live in RECEIPTS_DIR (the `receipts` volume in production, kept
 *   under that name for existing deployments), named by their SHA-256 under
 *   a two-character folder (`ab/abcdef…`), written atomically and never
 *   changed. The same bytes stored twice are one file, so one file can be
 *   both a receipt and a photo size.
 * - The daily backup mirrors the whole tree (scripts/backup), so anything
 *   stored here is backed up.
 * - A file is in use while any row of any kind points to it
 *   (`referencedFiles`). Only then may it go: at once when its last
 *   reference is removed, or with the daily sweep.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { env } from "@/env";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

const SHA = /^[0-9a-f]{64}$/;

export function storedFilePath(sha256: string): string {
  if (!SHA.test(sha256)) throw new Error("not a SHA-256");
  return join(env.RECEIPTS_DIR, sha256.slice(0, 2), sha256);
}

/** Writes the bytes under their hash, unless that file exists. Returns the hash. */
export async function storeFile(bytes: Uint8Array): Promise<string> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const path = storedFilePath(sha256);
  try {
    await stat(path);
    return sha256;
  } catch {
    // Not there yet.
  }
  await mkdir(join(env.RECEIPTS_DIR, sha256.slice(0, 2)), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  // Readable by the backup service (another user), writable by the app only.
  await writeFile(temporary, bytes, { mode: 0o644 });
  await rename(temporary, path);
  return sha256;
}

export function readStoredFile(sha256: string): Promise<Buffer> {
  return readFile(storedFilePath(sha256));
}

/**
 * Every row that points to a file, of every kind. A new kind of stored file
 * must be added here, or the sweep below deletes its files.
 */
async function referencedFiles(only?: string): Promise<Set<string>> {
  const [receipts, photoSizes] = await Promise.all([
    db.transactionAttachment.findMany({
      where: only ? { OR: [{ sha256: only }, { thumbnailSha256: only }] } : undefined,
      select: { sha256: true, thumbnailSha256: true },
    }),
    db.propertyPhotoSize.findMany({
      where: only ? { sha256: only } : undefined,
      select: { sha256: true },
    }),
  ]);
  return new Set(
    [
      ...receipts.flatMap((r) => [r.sha256, r.thumbnailSha256]),
      ...photoSizes.map((s) => s.sha256),
    ].filter((sha): sha is string => Boolean(sha)),
  );
}

/** Deletes the files no row points to any more, among `sha256s`. */
export async function removeIfUnreferenced(sha256s: (string | null)[]): Promise<void> {
  for (const sha of new Set(sha256s)) {
    if (sha && !(await referencedFiles(sha)).has(sha)) {
      await rm(storedFilePath(sha), { force: true });
    }
  }
}

/**
 * Deletes files nothing points to: left by deleted transactions or photos,
 * or by an upload that failed after its file was written. Files younger
 * than `graceMs` stay, so an upload in progress is never caught.
 */
export async function removeOrphanFiles({
  now = new Date(),
  graceMs = 60 * 60_000,
}: { now?: Date; graceMs?: number } = {}): Promise<{ removed: number; kept: number }> {
  const result = { removed: 0, kept: 0 };
  let folders: string[];
  try {
    folders = await readdir(env.RECEIPTS_DIR);
  } catch {
    return result;
  }
  const referenced = await referencedFiles();
  for (const folder of folders) {
    if (!/^[0-9a-f]{2}$/.test(folder)) continue;
    for (const name of await readdir(join(env.RECEIPTS_DIR, folder))) {
      const path = join(env.RECEIPTS_DIR, folder, name);
      if (referenced.has(name)) {
        result.kept++;
        continue;
      }
      const { mtime } = await stat(path);
      if (now.getTime() - mtime.getTime() < graceMs) continue;
      await rm(path, { force: true });
      result.removed++;
    }
  }
  if (result.removed > 0) logger.info(result, "orphaned files removed");
  return result;
}
