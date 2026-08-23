#!/usr/bin/env bun
import { Command } from "commander";
import * as p from "@clack/prompts";
import { chmod, copyFile, mkdir, open } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "path";
import { $ } from "bun";
import {
  loadEnvQuickSections,
  loadState,
  resolveEnvQuickPath,
  saveState,
} from "../src/core/config";
import {
  createYamlPresetContent,
  getPresetNames,
  getYamlPresetNames,
  isEnvQuickYamlPath,
} from "../src/core/parser";
import { performSwitch } from "../src/commands/switch";

const WORKTREE_PRESET_SOURCE = ".quickenv/.env.worktree.yaml";
const NO_PARENT_PRESET = "__no_parent_preset__";

interface WorktreeOptions {
  branch?: string;
  path?: string;
  from?: string;
}

type WorktreeState = {
  activePreset?: string;
  envPath?: string | string[];
  isProtected?: boolean;
};

type PresetSource = {
  path: string;
  label: string;
  presetNames: string[];
};

function sanitizeName(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 255);
}

function resolveFromRoot(rootDir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(rootDir, path);
}

export function addWorktreeSourceToState(
  state: WorktreeState,
  rootDir: string,
  sourcePath: string,
  fallbackSourcePaths: string[] = [],
): WorktreeState {
  const configuredPaths = state.envPath
    ? Array.isArray(state.envPath)
      ? [...state.envPath]
      : [state.envPath]
    : fallbackSourcePaths.map((path) => relative(rootDir, path));
  const sourceAbsolutePath = resolveFromRoot(rootDir, sourcePath);

  if (
    !configuredPaths.some(
      (path) => resolveFromRoot(rootDir, path) === sourceAbsolutePath,
    )
  ) {
    configuredPaths.push(sourcePath);
  }

  return { ...state, envPath: configuredPaths };
}

async function writeSecretFile(path: string, content: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error: unknown) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "EEXIST"
    ) {
      throw error;
    }
    await chmod(path, 0o600);
    handle = await open(path, "w");
  }

  try {
    await handle.writeFile(content);
  } finally {
    await handle.close();
  }
}

export async function createPresetInSource(
  sourcePath: string,
  presetName: string,
  parentPreset?: string,
): Promise<void> {
  const file = Bun.file(sourcePath);
  const exists = await file.exists();
  const content = exists ? await file.text() : "";
  const updatedContent = createYamlPresetContent(
    content,
    presetName,
    parentPreset,
  );

  await mkdir(dirname(sourcePath), { recursive: true });
  if (exists) {
    await Bun.write(sourcePath, updatedContent);
  } else {
    await writeSecretFile(sourcePath, updatedContent);
  }
}

async function configureWorktreePreset(
  worktreePath: string,
  branch: string,
): Promise<string | undefined> {
  const statePath = join(worktreePath, ".quickenv/.quickenv.state");
  const state = (await loadState(statePath)) as WorktreeState;
  const envResult = await resolveEnvQuickPath(statePath);
  const existingPaths: string[] = [];
  for (const path of envResult.paths) {
    if (await Bun.file(path).exists()) existingPaths.push(path);
  }

  const sections =
    existingPaths.length > 0
      ? await loadEnvQuickSections({
          ...envResult,
          path: existingPaths[existingPaths.length - 1]!,
          paths: existingPaths,
        })
      : [];
  const presetNames = getPresetNames(sections);
  const mode = await p.select({
    message: "How should Quickenv configure this worktree?",
    options: [
      ...(presetNames.length > 0
        ? [{ value: "existing", label: "Use an existing preset" }]
        : []),
      { value: "new", label: "Create a new preset" },
      { value: "skip", label: "Skip Quickenv preset setup" },
    ],
  });

  if (p.isCancel(mode) || mode === "skip") {
    p.log.info("Skipped Quickenv preset setup");
    return undefined;
  }

  let presetName: string;
  if (mode === "existing") {
    const selected = await p.select({
      message: "Which preset should this worktree use?",
      options: presetNames.map((name) => ({ value: name, label: name })),
    });
    if (p.isCancel(selected)) {
      p.log.info("Skipped Quickenv preset setup");
      return undefined;
    }
    presetName = selected;
  } else {
    const enteredName = await p.text({
      message: "Name for the new preset:",
      initialValue: sanitizeName(`worktree-${branch}`),
      validate: (value) => {
        const name = value.trim();
        if (!name) return "Enter a preset name.";
        if (presetNames.includes(name)) {
          return "That preset already exists. Choose another name.";
        }
      },
    });
    if (p.isCancel(enteredName)) {
      p.log.info("Skipped Quickenv preset setup");
      return undefined;
    }
    presetName = enteredName.trim();

    const localSourcePath = join(worktreePath, WORKTREE_PRESET_SOURCE);
    const yamlSources: PresetSource[] = [];
    for (const path of existingPaths) {
      if (!isEnvQuickYamlPath(path)) continue;
      yamlSources.push({
        path,
        label: relative(worktreePath, path) || basename(path),
        presetNames: getYamlPresetNames(await Bun.file(path).text()),
      });
    }

    const sourceSelection = await p.select({
      message: "Which source file should contain the new preset?",
      options: [
        ...yamlSources
          .filter((source) => resolve(source.path) !== resolve(localSourcePath))
          .map((source) => ({
            value: source.path,
            label: `${source.label} (${source.presetNames.length} preset${source.presetNames.length === 1 ? "" : "s"})`,
          })),
        {
          value: localSourcePath,
          label: `${(await Bun.file(localSourcePath).exists()) ? "Use" : "Create"} ${WORKTREE_PRESET_SOURCE} for this worktree only`,
        },
      ],
    });
    if (p.isCancel(sourceSelection)) {
      p.log.info("Skipped Quickenv preset setup");
      return undefined;
    }

    const selectedSource =
      yamlSources.find(
        (source) => resolve(source.path) === resolve(sourceSelection),
      ) ?? {
        path: sourceSelection,
        label: WORKTREE_PRESET_SOURCE,
        presetNames: [],
      };
    const allSourcesAreYaml = existingPaths.every(isEnvQuickYamlPath);
    const availableParents = allSourcesAreYaml
      ? presetNames
      : selectedSource.presetNames;
    const parentSelection = await p.select({
      message: "Which preset should the new preset extend?",
      options: [
        ...availableParents.map((name) => ({ value: name, label: name })),
        { value: NO_PARENT_PRESET, label: "Do not extend a preset" },
      ],
    });
    if (p.isCancel(parentSelection)) {
      p.log.info("Skipped Quickenv preset setup");
      return undefined;
    }

    await createPresetInSource(
      selectedSource.path,
      presetName,
      parentSelection === NO_PARENT_PRESET ? undefined : parentSelection,
    );

    if (resolve(selectedSource.path) === resolve(localSourcePath)) {
      await saveState(
        addWorktreeSourceToState(
          state,
          worktreePath,
          WORKTREE_PRESET_SOURCE,
          existingPaths,
        ),
        statePath,
      );
    }
  }

  await performSwitch(presetName, worktreePath);
  const activeState = await loadState(statePath);
  if (activeState.activePreset !== presetName) {
    p.log.warn(`Quickenv preset '${presetName}' was not activated`);
    return undefined;
  }

  p.log.success(`Configured Quickenv preset '${presetName}'`);
  return presetName;
}

async function findGitRoot(cwd: string): Promise<string> {
  const result = await $`cd ${cwd} && git rev-parse --show-toplevel`.quiet();
  return result.text().trim();
}

async function worktreeExists(cwd: string, branch: string): Promise<boolean> {
  try {
    const result = await $`cd ${cwd} && git worktree list --porcelain`.quiet();
    const lines = result.text().split("\n");
    for (const line of lines) {
      if (line.startsWith("branch ") && line.includes(`/refs/heads/${branch}`)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function copyWorktreeIncludeFiles(
  mainWorktree: string,
  targetWorktree: string,
  includeFile: string = ".worktreeinclude"
): Promise<string[]> {
  const includePath = join(mainWorktree, includeFile);
  const file = Bun.file(includePath);

  if (!(await file.exists())) {
    return [];
  }

  const content = await file.text();
  const patterns = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (patterns.length === 0) {
    return [];
  }

  const copied: string[] = [];

  for (const pattern of patterns) {
    const glob = new Bun.Glob(pattern);
    for await (const filePath of glob.scan({ cwd: mainWorktree })) {
      const fullSourcePath = join(mainWorktree, filePath);
      const fullTargetPath = join(targetWorktree, filePath);
      const targetDir = dirname(fullTargetPath);

      // Ensure target directory exists
      await $`mkdir -p ${targetDir}`.quiet();

      // Copy file
      await $`cp ${fullSourcePath} ${fullTargetPath}`.quiet();
      copied.push(filePath);
    }
  }

  return copied;
}

async function getQuickenvConfigPath(worktree: string): Promise<string | undefined> {
  if (await Bun.file(join(worktree, ".quickenv/.env.quick.yaml")).exists()) {
    return ".quickenv/.env.quick.yaml";
  }
  if (await Bun.file(join(worktree, ".quickenv/.env.quick")).exists()) {
    return ".quickenv/.env.quick";
  }
}

export async function copyQuickenvConfig(
  sourceWorktree: string,
  targetWorktree: string,
): Promise<string | undefined> {
  const relativePath = await getQuickenvConfigPath(sourceWorktree);
  if (!relativePath || await Bun.file(join(targetWorktree, relativePath)).exists()) {
    return undefined;
  }

  await mkdir(dirname(join(targetWorktree, relativePath)), { recursive: true });
  await copyFile(join(sourceWorktree, relativePath), join(targetWorktree, relativePath));
  return relativePath;
}

export function getDefaultWorktreePath(
  mainWorktree: string,
  branch: string,
): string {
  return join(
    dirname(mainWorktree),
    `${basename(mainWorktree)}-${branch.replace(/\//g, "-")}`,
  );
}

export function buildPostWorktreeHookEnv(
  worktreePath: string,
  branch: string,
  preset?: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    WORKTREE_PATH: worktreePath,
    BRANCH_NAME: branch,
    ...(preset ? { QUICKENV_PRESET: preset } : {}),
  };
}

async function runPostWorktreeHook(
  mainWorktree: string,
  worktreePath: string,
  branch: string,
  preset?: string,
): Promise<void> {
  const hooksDir = join(mainWorktree, ".quickenv/hooks");
  const tsHook = join(hooksDir, "post-worktree.ts");
  const shHook = join(hooksDir, "post-worktree.sh");

  let hookPath: string | null = null;
  let hookType: "ts" | "sh" | null = null;

  // Check for .ts hook first, then .sh
  const tsFile = Bun.file(tsHook);
  if (await tsFile.exists()) {
    hookPath = tsHook;
    hookType = "ts";
  } else {
    const shFile = Bun.file(shHook);
    if (await shFile.exists()) {
      hookPath = shHook;
      hookType = "sh";
    }
  }

  if (!hookPath || !hookType) {
    return;
  }

  p.log.step("Running post-worktree hook...");

  try {
    const env = buildPostWorktreeHookEnv(worktreePath, branch, preset);

    if (hookType === "ts") {
      // Run TypeScript hook with bun from the new worktree directory
      const proc = Bun.spawn(["bun", hookPath], {
        cwd: worktreePath,
        env,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        p.log.warn(`Post-worktree hook exited with code ${exitCode}`);
      } else {
        p.log.success("Post-worktree hook completed");
      }
    } else {
      // Run shell hook
      const proc = Bun.spawn(["sh", hookPath], {
        cwd: worktreePath,
        env,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        p.log.warn(`Post-worktree hook exited with code ${exitCode}`);
      } else {
        p.log.success("Post-worktree hook completed");
      }
    }
  } catch (error) {
    p.log.warn(`Failed to run post-worktree hook: ${error}`);
  }
}

async function createWorktree(branchArg: string | WorktreeOptions, opts?: WorktreeOptions) {
  // Handle both standalone CLI (options only) and subcommand (branch, options) signatures
  const options: WorktreeOptions = opts || (typeof branchArg === 'object' ? branchArg : {});
  const branchFromArg = typeof branchArg === 'string' ? branchArg : undefined;

  p.intro("quickenv worktree");

  const mainWorktree = await findGitRoot(process.cwd());

  // Get or prompt for branch name
  let branch = branchFromArg || options.branch;
  if (!branch) {
    const input = await p.text({
      message: "Enter a branch name:",
      placeholder: "feature/my-feature",
    });

    if (p.isCancel(input)) {
      p.outro("Cancelled");
      process.exit(0);
    }
    branch = input;
  }

  // Determine worktree path
  let worktreePath = options.path;
  if (!worktreePath) {
    const defaultPath = getDefaultWorktreePath(mainWorktree, branch);
    const input = await p.text({
      message: "Worktree directory:",
      initialValue: defaultPath,
      validate: (value) => {
        if (!value.trim()) return "Enter a worktree directory.";
      },
    });

    if (p.isCancel(input)) {
      p.outro("Cancelled");
      process.exit(0);
    }
    worktreePath = input.trim();
  }

  // Check if worktree already exists
  if (await worktreeExists(mainWorktree, branch)) {
    p.log.error(`Worktree for branch '${branch}' already exists.`);
    process.exit(1);
  }

  // Create the worktree
  p.log.step(`Creating worktree for branch '${branch}'...`);

  try {
    // Check if branch exists locally
    let branchExists = false;
    try {
      await $`cd ${mainWorktree} && git rev-parse --verify ${branch}`.quiet();
      branchExists = true;
    } catch {
      branchExists = false;
    }

    if (branchExists) {
      // Branch exists, create worktree from it
      await $`cd ${mainWorktree} && git worktree add "${worktreePath}" "${branch}"`;
    } else {
      // Create new branch and worktree
      await $`cd ${mainWorktree} && git worktree add "${worktreePath}" -b "${branch}"`;
    }
  } catch (error) {
    p.log.error(`Failed to create worktree: ${error}`);
    process.exit(1);
  }

  p.log.success(`Created worktree at ${worktreePath}`);

  // Copy files from .worktreeinclude
  p.log.step("Copying files from .worktreeinclude...");
  const copiedFiles = await copyWorktreeIncludeFiles(
    mainWorktree,
    worktreePath,
    options.from ? join(options.from, ".worktreeinclude") : undefined
  );

  if (copiedFiles.length > 0) {
    p.log.success(`Copied ${copiedFiles.length} file(s):`);
    for (const file of copiedFiles) {
      console.log(`  • ${file}`);
    }
  } else {
    p.log.info("No files to copy from .worktreeinclude");
  }

  const sourceConfig = await getQuickenvConfigPath(mainWorktree);
  if (sourceConfig && !(await Bun.file(join(worktreePath, sourceConfig)).exists())) {
    const shouldCopyConfig = await p.confirm({
      message: `Copy ${sourceConfig} to the new worktree?`,
      initialValue: true,
    });
    if (p.isCancel(shouldCopyConfig) || !shouldCopyConfig) {
      p.log.info("Skipped Quickenv config copy");
    } else {
      await copyQuickenvConfig(mainWorktree, worktreePath);
      p.log.success(`Copied ${sourceConfig}`);
    }
  }

  // Initialize quickenv in the new worktree
  p.log.step("Setting up quickenv...");

  const statePath = join(worktreePath, ".quickenv/.quickenv.state");
  const mainStatePath = join(mainWorktree, ".quickenv/.quickenv.state");
  const mainStateFile = Bun.file(mainStatePath);

  // Build the state for the new worktree - only envPath, no activePreset
  const newState: Record<string, unknown> = {};

  // Check if main worktree has envPath in its state
  if (await mainStateFile.exists()) {
    try {
      const mainState = await mainStateFile.json();
      if (mainState.envPath) {
        // Calculate relative path from new worktree to main's envPath
        // envPath can be a string or array of strings
        const calculateRelativePath = (path: string): string => {
          if (path.startsWith("/")) {
            return path;
          }
          if (path.startsWith("../")) {
            return join("..", basename(mainWorktree), path);
          }
          return path;
        };

        if (Array.isArray(mainState.envPath)) {
          // Handle array of paths
          const envPaths = mainState.envPath.map(calculateRelativePath);
          newState.envPath = envPaths;
          p.log.success(`Linked to shared env files: ${envPaths.join(", ")}`);
        } else {
          // Handle single string path
          const envPath = calculateRelativePath(mainState.envPath);
          newState.envPath = envPath;
          p.log.success(`Linked to shared env file: ${envPath}`);
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Create the state file (may be empty if no envPath found)
  await mkdir(dirname(statePath), { recursive: true });
  await Bun.write(statePath, JSON.stringify(newState, null, 2));
  p.log.success("Created .quickenv.state");

  const preset = await configureWorktreePreset(worktreePath, branch);

  // Run post-worktree hook if it exists
  await runPostWorktreeHook(mainWorktree, worktreePath, branch, preset);

  // Summary
  p.outro("Worktree created successfully!");
  console.log("\nNext step:");
  console.log(`  cd ${relative(process.cwd(), worktreePath)}`);
}

export const worktreeCommand = new Command("worktree")
  .description("Create a new git worktree with quickenv support")
  .argument("[branch]", "Branch name to create")
  .option("-p, --path <path>", "Path for the new worktree")
  .option("-f, --from <path>", "Source worktree path (defaults to current)")
  .action(createWorktree);

// Only parse if this file is run directly (not imported)
if (import.meta.main) {
  const program = new Command();
  program
    .name("create-worktree")
    .description("Create a new git worktree with quickenv support")
    .argument("[branch]", "Branch name to create")
    .option("-p, --path <path>", "Path for the new worktree")
    .option("-f, --from <path>", "Source worktree path (defaults to current)")
    .action(createWorktree);

  program.parse();
}
