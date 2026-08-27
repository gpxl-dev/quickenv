import { Command } from "commander";
import * as p from "@clack/prompts";
import { $ } from "bun";
import {
  chmod,
  link,
  lstat,
  mkdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { homedir } from "os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "path";
import {
  readConfig,
  readState,
  resolveEnvQuickPath,
  saveState,
  type State,
} from "../core/config";
import {
  assertRegularFile,
  copyPrivateFileAtomic,
  filesHaveSameContents,
  moveAsidePrivateFile,
  rollbackPrivateReplacement,
  type PrivateCopyResult,
} from "../core/files";
import { isEnvQuickYamlPath } from "../core/parser";

interface ExtractPrompts {
  destinationDirectory(initialValue: string): Promise<string | null>;
  confirmDestination(path: string, identical: boolean): Promise<boolean | null>;
  confirmLinkOthers(): Promise<boolean | null>;
  selectLinkDirectories(paths: string[]): Promise<string[] | null>;
  confirmDistinctSource(rootDir: string): Promise<boolean | null>;
}

interface ExtractReporter {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
}

interface ExtractOperations {
  saveState: typeof saveState;
  removeSource(path: string, destinationPath: string): Promise<string[]>;
}

export interface ExtractResult {
  status: "cancelled" | "extracted";
  destinationPath?: string;
  sourceRemoved?: boolean;
  linked: string[];
  skipped: string[];
  failed: string[];
}

const quietReporter: ExtractReporter = {
  info() {},
  success() {},
  warn() {},
};

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

function resolveStatePath(rootDir: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(rootDir, path);
}

export function replaceSourceInState(
  state: State,
  rootDir: string,
  sourcePath: string,
  destinationPath: string,
): State {
  if (!state.envPath) return { ...state, envPath: destinationPath };

  const paths = Array.isArray(state.envPath)
    ? [...state.envPath]
    : [state.envPath];
  let replaced = false;
  const updated = paths.map((path) => {
    if (resolveStatePath(rootDir, path) !== resolve(sourcePath)) return path;
    replaced = true;
    return destinationPath;
  });

  if (!replaced) updated.push(destinationPath);
  return {
    ...state,
    envPath: Array.isArray(state.envPath) || !replaced ? updated : updated[0],
  };
}

async function canonicalDirectory(input: string, rootDir: string): Promise<string> {
  const requested = resolve(rootDir, expandHome(input.trim()));
  if (isInside(rootDir, requested)) {
    throw new Error("The shared directory must be outside the current worktree.");
  }

  await mkdir(requested, { recursive: true, mode: 0o700 });
  const canonical = await realpath(requested);
  if (isInside(rootDir, canonical)) {
    throw new Error("The shared directory resolves inside the current worktree.");
  }
  return canonical;
}

async function gitCommonDirectory(rootDir: string): Promise<string | null> {
  try {
    const result = await $`git -C ${rootDir} rev-parse --git-common-dir`.quiet();
    const value = result.text().trim();
    return await realpath(isAbsolute(value) ? value : resolve(rootDir, value));
  } catch {
    return null;
  }
}

export async function discoverOtherWorktrees(rootDir: string): Promise<string[]> {
  try {
    const current = await realpath(rootDir);
    const result = await $`git -C ${rootDir} worktree list --porcelain`.quiet();
    const paths: string[] = [];
    for (const line of result.text().split("\n")) {
      if (!line.startsWith("worktree ")) continue;
      const path = await realpath(line.slice("worktree ".length));
      if (path !== current) paths.push(path);
    }
    return paths;
  } catch {
    return [];
  }
}

async function validateLinkRoot(
  rootDir: string,
  expectedGitCommonDir: string | null,
): Promise<string> {
  const canonical = await realpath(rootDir);
  const stats = await lstat(canonical);
  if (!stats.isDirectory()) throw new Error(`Not a directory: ${rootDir}`);

  const gitRootResult = await $`git -C ${canonical} rev-parse --show-toplevel`.quiet();
  const gitRoot = await realpath(gitRootResult.text().trim());
  if (gitRoot !== canonical) {
    throw new Error(`Not a Quickenv worktree root: ${rootDir}`);
  }

  const commonDir = await gitCommonDirectory(canonical);
  if (!expectedGitCommonDir || commonDir !== expectedGitCommonDir) {
    throw new Error(`Not a worktree of the current repository: ${rootDir}`);
  }

  if (!(await readConfig(join(canonical, "quickenv.yaml")))) {
    throw new Error(`Missing quickenv.yaml: ${rootDir}`);
  }

  const quickenvDir = join(canonical, ".quickenv");
  if (await pathExists(quickenvDir)) {
    const quickenvStats = await lstat(quickenvDir);
    if (quickenvStats.isSymbolicLink() || !quickenvStats.isDirectory()) {
      throw new Error(`Invalid .quickenv directory: ${rootDir}`);
    }
  }
  return canonical;
}

async function sourceCandidates(rootDir: string): Promise<string[]> {
  const statePath = join(rootDir, ".quickenv/.quickenv.state");
  const envResult = await resolveEnvQuickPath(statePath);
  return [...new Set([
    ...envResult.paths.map((path) => resolve(path)),
    join(rootDir, ".quickenv/.env.quick.yaml"),
    join(rootDir, ".quickenv/.env.quick"),
  ])];
}

async function hasDistinctSource(
  rootDir: string,
  destinationPath: string,
): Promise<boolean> {
  for (const path of await sourceCandidates(rootDir)) {
    if (resolve(path) === resolve(destinationPath) || !(await pathExists(path))) {
      continue;
    }
    await assertRegularFile(path);
    if (!(await filesHaveSameContents(path, destinationPath))) return true;
  }
  return false;
}

async function removeSourceIfUnchanged(
  sourcePath: string,
  destinationPath: string,
): Promise<string[]> {
  const quarantinePath = join(
    dirname(sourcePath),
    `.${basename(sourcePath)}.extract-${process.pid}-${crypto.randomUUID()}`,
  );
  await rename(sourcePath, quarantinePath);

  try {
    if (!(await filesHaveSameContents(quarantinePath, destinationPath))) {
      try {
        await link(quarantinePath, sourcePath);
        return [sourcePath, quarantinePath];
      } catch (error: unknown) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "EEXIST"
        ) {
          return [sourcePath, quarantinePath];
        }
        throw error;
      }
    }

    await rm(quarantinePath);
    return (await pathExists(sourcePath)) ? [sourcePath] : [];
  } catch (error) {
    if (await pathExists(quarantinePath)) {
      try {
        await link(quarantinePath, sourcePath);
      } catch {
        // Keep the quarantine file if another source appeared.
      }
    }
    throw error;
  }
}

async function removeIdenticalLocalSources(
  rootDir: string,
  destinationPath: string,
  candidates: string[],
): Promise<void> {
  for (const path of candidates) {
    if (
      resolve(path) === resolve(destinationPath) ||
      !isInside(rootDir, resolve(path)) ||
      !(await pathExists(path))
    ) {
      continue;
    }
    await assertRegularFile(path);
    if ((await realpath(path)) !== resolve(path)) continue;
    await removeSourceIfUnchanged(path, destinationPath);
  }
}

export async function linkQuickenvRoot(
  rootDir: string,
  destinationPath: string,
  expectedGitCommonDir: string | null,
  confirmDistinctSource: (rootDir: string) => Promise<boolean | null>,
  operations: Pick<ExtractOperations, "saveState"> = { saveState },
): Promise<"linked" | "already-linked" | "skipped"> {
  const canonical = await validateLinkRoot(rootDir, expectedGitCommonDir);
  const canonicalDestination = await realpath(destinationPath);
  await assertRegularFile(destinationPath);
  if (
    canonicalDestination !== resolve(destinationPath) ||
    !isEnvQuickYamlPath(destinationPath)
  ) {
    throw new Error(`Invalid shared Quickenv source: ${destinationPath}`);
  }

  const statePath = join(canonical, ".quickenv/.quickenv.state");
  const state = await readState(statePath);
  const configuredPaths = state.envPath
    ? Array.isArray(state.envPath)
      ? state.envPath
      : [state.envPath]
    : [];

  if (
    configuredPaths.length === 1 &&
    resolveStatePath(canonical, configuredPaths[0]!) === resolve(destinationPath)
  ) {
    return "already-linked";
  }

  const priorSourceCandidates = await sourceCandidates(canonical);
  if (
    (await hasDistinctSource(canonical, destinationPath)) &&
    (await confirmDistinctSource(canonical)) !== true
  ) {
    return "skipped";
  }

  await operations.saveState({ ...state, envPath: destinationPath }, statePath);
  await removeIdenticalLocalSources(
    canonical,
    destinationPath,
    priorSourceCandidates,
  ).catch(() => undefined);
  return "linked";
}

export async function performExtract(
  rootDir: string,
  prompts: ExtractPrompts,
  reporter: ExtractReporter = quietReporter,
  operationOverrides: Partial<ExtractOperations> = {},
): Promise<ExtractResult> {
  const operations: ExtractOperations = {
    saveState,
    removeSource: removeSourceIfUnchanged,
    ...operationOverrides,
  };
  const canonicalRoot = await realpath(rootDir);
  if (!(await readConfig(join(canonicalRoot, "quickenv.yaml")))) {
    throw new Error(`Missing quickenv.yaml: ${canonicalRoot}`);
  }

  const statePath = join(canonicalRoot, ".quickenv/.quickenv.state");
  const state = await readState(statePath);
  const envResult = await resolveEnvQuickPath(statePath);
  const sourcePath = resolve(envResult.path);
  if (!(await pathExists(sourcePath))) {
    throw new Error(`Active Quickenv source not found: ${sourcePath}`);
  }
  await assertRegularFile(sourcePath);
  if ((await realpath(sourcePath)) !== sourcePath) {
    throw new Error(`Active Quickenv source uses a symlinked path: ${sourcePath}`);
  }
  if (!isEnvQuickYamlPath(sourcePath)) {
    throw new Error("quickenv extract requires an active YAML source.");
  }
  if (!isInside(canonicalRoot, sourcePath)) {
    throw new Error(`The active Quickenv source is already external: ${sourcePath}`);
  }

  const destinationInput = await prompts.destinationDirectory(
    join(dirname(canonicalRoot), `${basename(canonicalRoot)}-quickenv`),
  );
  if (destinationInput === null || !destinationInput.trim()) {
    return { status: "cancelled", linked: [], skipped: [], failed: [] };
  }

  const destinationDirectory = await canonicalDirectory(
    destinationInput,
    canonicalRoot,
  );
  const destinationPath = join(destinationDirectory, basename(sourcePath));
  const destinationExists = await pathExists(destinationPath);
  let destinationIdentical = false;

  if (destinationExists) {
    await assertRegularFile(destinationPath);
    destinationIdentical = await filesHaveSameContents(
      sourcePath,
      destinationPath,
    );
    if (
      (await prompts.confirmDestination(
        destinationPath,
        destinationIdentical,
      )) !== true
    ) {
      return { status: "cancelled", linked: [], skipped: [], failed: [] };
    }
  }

  let backup: { backupPath: string; mode: number } | undefined;
  let identicalDestinationMode: number | undefined;
  let installedCopy: PrivateCopyResult | undefined;
  try {
    if (destinationExists && !destinationIdentical) {
      backup = await moveAsidePrivateFile(destinationPath);
    }
    if (!destinationIdentical) {
      installedCopy = await copyPrivateFileAtomic(sourcePath, destinationPath);
      if (!installedCopy.verified) {
        throw new Error(`Failed to verify copied file: ${destinationPath}`);
      }
    } else {
      identicalDestinationMode = (await lstat(destinationPath)).mode & 0o777;
      await chmod(destinationPath, 0o600);
    }

    const updatedState = replaceSourceInState(
      state,
      canonicalRoot,
      sourcePath,
      destinationPath,
    );
    await operations.saveState(updatedState, statePath);
  } catch (error) {
    if (installedCopy || backup) {
      try {
        const retainedPaths = await rollbackPrivateReplacement(
          destinationPath,
          installedCopy,
          backup,
        );
        for (const path of retainedPaths) {
          reporter.warn(`Rollback retained a concurrently changed file: ${path}`);
        }
      } catch {
        reporter.warn(`Rollback could not finish for: ${destinationPath}`);
      }
    } else if (identicalDestinationMode !== undefined) {
      await chmod(destinationPath, identicalDestinationMode).catch(() => undefined);
    }
    throw error;
  }

  let sourceRemoved = true;
  if (backup) {
    try {
      await rm(backup.backupPath);
    } catch {
      sourceRemoved = false;
      reporter.warn(`Could not remove private backup: ${backup.backupPath}`);
    }
  }

  if (sourceRemoved) {
    try {
      const retainedPaths = await operations.removeSource(
        sourcePath,
        destinationPath,
      );
      sourceRemoved = retainedPaths.length === 0;
      for (const path of retainedPaths) {
        reporter.warn(`Shared source is configured, but a local copy remains: ${path}`);
      }
    } catch {
      sourceRemoved = false;
      reporter.warn(`Shared source is configured, but the local copy remains: ${sourcePath}`);
    }
  }

  reporter.success(`Extracted Quickenv source to ${destinationPath}`);

  const linked: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  if ((await prompts.confirmLinkOthers()) === true) {
    const candidates = await discoverOtherWorktrees(canonicalRoot);
    if (candidates.length === 0) {
      reporter.info("No other Git worktrees were found.");
    } else {
      const selected = await prompts.selectLinkDirectories(candidates);
      const commonDir = await gitCommonDirectory(canonicalRoot);
      for (const directory of selected ?? []) {
        try {
          const result = await linkQuickenvRoot(
            directory,
            destinationPath,
            commonDir,
            prompts.confirmDistinctSource,
            operations,
          );
          if (result === "skipped") {
            skipped.push(directory);
            reporter.info(`Skipped ${directory}`);
          } else {
            linked.push(directory);
            reporter.success(`Linked ${directory}`);
          }
        } catch {
          failed.push(directory);
          reporter.warn(`Could not link ${directory}`);
        }
      }
    }
  }

  if (linked.length + skipped.length + failed.length > 0) {
    reporter.info(
      `Worktree links: ${linked.length} linked, ${skipped.length} skipped, ${failed.length} failed.`,
    );
  }

  return {
    status: "extracted",
    destinationPath,
    sourceRemoved,
    linked,
    skipped,
    failed,
  };
}

const clackPrompts: ExtractPrompts = {
  async destinationDirectory(initialValue) {
    const value = await p.text({
      message: "Shared directory for the Quickenv source:",
      initialValue,
      validate: (input) => input.trim() ? undefined : "Enter a directory.",
    });
    return p.isCancel(value) ? null : value.trim();
  },
  async confirmDestination(path, identical) {
    const value = await p.confirm({
      message: identical
        ? `Reuse the existing identical source at ${path}?`
        : `Replace the existing source at ${path}?`,
      initialValue: false,
    });
    return p.isCancel(value) ? null : value;
  },
  async confirmLinkOthers() {
    const value = await p.confirm({
      message: "Link other existing worktrees to this shared source now?",
      initialValue: true,
    });
    return p.isCancel(value) ? null : value;
  },
  async selectLinkDirectories(paths) {
    const value = await p.multiselect({
      message: "Select worktrees to link:",
      options: paths.map((path) => ({ value: path, label: path })),
      required: false,
    });
    return p.isCancel(value) ? null : value;
  },
  async confirmDistinctSource(rootDir) {
    const value = await p.confirm({
      message: `${rootDir} has a distinct local or configured source. Link it and keep that source in place?`,
      initialValue: false,
    });
    return p.isCancel(value) ? null : value;
  },
};

const clackReporter: ExtractReporter = {
  info: (message) => p.log.info(message),
  success: (message) => p.log.success(message),
  warn: (message) => p.log.warn(message),
};

export const extractCommand = new Command("extract")
  .description("Move the active secret source to a shared directory")
  .action(async () => {
    p.intro("quickenv extract");
    try {
      const result = await performExtract(process.cwd(), clackPrompts, clackReporter);
      p.outro(
        result.status === "cancelled"
          ? "Cancelled"
          : result.sourceRemoved === false
            ? "Extraction complete with local cleanup pending"
            : "Extraction complete",
      );
    } catch (error) {
      p.log.error(error instanceof Error ? error.message : "Extraction failed");
      p.outro("Extraction failed");
      process.exitCode = 1;
    }
  });
