import { createHash } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, join } from "path";

export interface FileIdentity {
  dev: number;
  ino: number;
}

export interface PrivateCopyResult {
  identity: FileIdentity;
  digest: string;
  verified: boolean;
}

function temporaryPath(path: string, label = "tmp"): string {
  return join(
    dirname(path),
    `.${basename(path)}.${label}-${process.pid}-${crypto.randomUUID()}`,
  );
}

function identity(stats: { dev: number; ino: number }): FileIdentity {
  return { dev: stats.dev, ino: stats.ino };
}

function sameIdentity(
  first: FileIdentity,
  second: FileIdentity,
): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

function digest(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

async function fileDigest(path: string): Promise<string> {
  return digest(await readFile(path));
}

function isCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

export async function assertRegularFile(path: string): Promise<void> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`Expected a regular file: ${path}`);
  }
}

export async function filesHaveSameContents(
  firstPath: string,
  secondPath: string,
): Promise<boolean> {
  const [first, second] = await Promise.all([
    readFile(firstPath),
    readFile(secondPath),
  ]);
  return first.equals(second);
}

export async function writePrivateFileAtomic(
  path: string,
  content: string | Uint8Array,
): Promise<FileIdentity> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = temporaryPath(path);
  let handle;

  try {
    handle = await open(tempPath, "wx", 0o600);
    await handle.writeFile(content);
    await handle.sync();
    const fileIdentity = identity(await handle.stat());
    await handle.close();
    handle = undefined;
    await chmod(tempPath, 0o600);
    await rename(tempPath, path);
    return fileIdentity;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function copyPrivateFileAtomic(
  sourcePath: string,
  destinationPath: string,
): Promise<PrivateCopyResult> {
  await assertRegularFile(sourcePath);
  const content = await readFile(sourcePath);
  const sourceDigest = digest(content);
  const fileIdentity = await writePrivateFileAtomic(destinationPath, content);
  let verified = false;
  try {
    verified = (await fileDigest(destinationPath)) === sourceDigest;
  } catch {
    // The caller owns rollback after the atomic install.
  }
  return { identity: fileIdentity, digest: sourceDigest, verified };
}

export async function moveAsidePrivateFile(path: string): Promise<{
  backupPath: string;
  mode: number;
}> {
  await assertRegularFile(path);
  const stats = await lstat(path);
  const backupPath = temporaryPath(path, "backup");
  await rename(path, backupPath);
  await chmod(backupPath, 0o600);
  return { backupPath, mode: stats.mode & 0o777 };
}

export async function rollbackPrivateReplacement(
  path: string,
  installed: PrivateCopyResult | undefined,
  backup?: { backupPath: string; mode: number },
): Promise<string[]> {
  const retainedPaths: string[] = [];

  try {
    const displacedPath = temporaryPath(path, "rollback");
    await rename(path, displacedPath);
    const displacedIdentity = identity(await lstat(displacedPath));
    if (
      installed &&
      sameIdentity(displacedIdentity, installed.identity) &&
      (await fileDigest(displacedPath)) === installed.digest
    ) {
      await rm(displacedPath);
    } else {
      retainedPaths.push(displacedPath);
    }
  } catch (error) {
    if (!isCode(error, "ENOENT")) throw error;
  }

  if (backup) {
    await chmod(backup.backupPath, backup.mode);
    try {
      await link(backup.backupPath, path);
      await rm(backup.backupPath);
    } catch (error) {
      if (!isCode(error, "EEXIST")) throw error;
      retainedPaths.push(backup.backupPath);
    }
  }

  return retainedPaths;
}
