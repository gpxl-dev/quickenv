#!/usr/bin/env bun
import { Command } from "commander";
import * as p from "@clack/prompts";
import ignore from "ignore";
import { join, relative, dirname, basename } from "path";
import { $ } from "bun";

interface WorktreeOptions {
  branch?: string;
  path?: string;
  from?: string;
}

async function findGitRoot(cwd: string): Promise<string> {
  const result = await $`cd ${cwd} && git rev-parse --show-toplevel`.quiet();
  return result.text().trim();
}

async function getCurrentBranch(cwd: string): Promise<string> {
  const result = await $`cd ${cwd} && git rev-parse --abbrev-ref HEAD`.quiet();
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

async function runPostWorktreeHook(
  mainWorktree: string,
  worktreePath: string,
  branch: string
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
    const env = {
      ...process.env,
      WORKTREE_PATH: worktreePath,
      BRANCH_NAME: branch,
    };

    if (hookType === "ts") {
      // Run TypeScript hook with bun from the new worktree directory
      const proc = Bun.spawn(["bun", hookPath], {
        cwd: worktreePath,
        env,
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
  const currentBranch = await getCurrentBranch(mainWorktree);

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
    // Default to sibling directory
    const parentDir = dirname(mainWorktree);
    const baseName = basename(mainWorktree);
    worktreePath = join(parentDir, `${baseName}-${branch.replace(/\//g, "-")}`);
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
          return path.startsWith("/") ? path : join("..", basename(mainWorktree), path);
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
  await Bun.write(statePath, JSON.stringify(newState, null, 2));
  p.log.success("Created .quickenv.state");

  // Run post-worktree hook if it exists
  await runPostWorktreeHook(mainWorktree, worktreePath, branch);

  // Summary
  p.outro("Worktree created successfully!");
  console.log("\nNext steps:");
  console.log(`  cd ${relative(process.cwd(), worktreePath)}`);
  console.log("  quickenv switch <preset>");
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
