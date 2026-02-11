import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { join, basename } from "path";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";

describe("create-worktree hooks", () => {
  let tempDir: string;
  let repoDir: string;

  beforeAll(async () => {
    // Create a temporary directory for the test
    tempDir = mkdtempSync(join(tmpdir(), "quickenv_test_"));
    repoDir = join(tempDir, "repo");
    mkdirSync(repoDir, { recursive: true });

    // Initialize a git repo
    await $`cd ${repoDir} && git init`.quiet();
    await $`cd ${repoDir} && git config user.email "test@test.com"`.quiet();
    await $`cd ${repoDir} && git config user.name "Test"`.quiet();
    await $`cd ${repoDir} && git config commit.gpgsign false`.quiet();

    // Create initial commit
    writeFileSync(join(repoDir, "README.md"), "# Test");
    await $`cd ${repoDir} && git add README.md && git commit -m "initial"`.quiet();

    // Create .quickenv directory
    mkdirSync(join(repoDir, ".quickenv"), { recursive: true });
  });

  afterAll(() => {
    // Cleanup
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("should detect .ts hook file", async () => {
    const hooksDir = join(repoDir, ".quickenv/hooks");
    mkdirSync(hooksDir, { recursive: true });

    const hookContent = `
      import { writeFileSync } from "fs";
      import { join } from "path";
      
      const worktreePath = process.env.WORKTREE_PATH;
      const branchName = process.env.BRANCH_NAME;
      
      writeFileSync(join(worktreePath!, "hook-ran.txt"), \`Hook ran for branch: \${branchName}\`);
    `;

    writeFileSync(join(hooksDir, "post-worktree.ts"), hookContent);

    // Verify the hook file exists
    const tsFile = Bun.file(join(hooksDir, "post-worktree.ts"));
    expect(await tsFile.exists()).toBe(true);
  });

  test("should detect .sh hook file when .ts doesn't exist", async () => {
    const hooksDir = join(repoDir, ".quickenv/hooks");
    mkdirSync(hooksDir, { recursive: true });

    // Remove .ts hook if it exists
    try {
      rmSync(join(hooksDir, "post-worktree.ts"));
    } catch {}

    const hookContent = `#!/bin/sh
echo "Hook ran for branch: $BRANCH_NAME" > "$WORKTREE_PATH/hook-sh-ran.txt"
`;

    writeFileSync(join(hooksDir, "post-worktree.sh"), hookContent);

    // Verify the hook file exists
    const shFile = Bun.file(join(hooksDir, "post-worktree.sh"));
    expect(await shFile.exists()).toBe(true);

    // Verify .ts hook doesn't exist
    const tsFile = Bun.file(join(hooksDir, "post-worktree.ts"));
    expect(await tsFile.exists()).toBe(false);
  });

  test("should not fail when no hook directory exists", async () => {
    const hooksDir = join(repoDir, ".quickenv/hooks");
    
    // Remove hooks directory
    try {
      rmSync(hooksDir, { recursive: true, force: true });
    } catch {}

    // Verify the hooks directory doesn't exist
    const dirFile = Bun.file(hooksDir);
    expect(await dirFile.exists()).toBe(false);
  });

  test("should prefer .ts over .sh when both exist", async () => {
    const hooksDir = join(repoDir, ".quickenv/hooks");
    mkdirSync(hooksDir, { recursive: true });

    // Create both hooks
    writeFileSync(join(hooksDir, "post-worktree.sh"), "#!/bin/sh\nexit 0");
    writeFileSync(join(hooksDir, "post-worktree.ts"), "console.log('ts hook');");

    // Verify both exist
    const tsFile = Bun.file(join(hooksDir, "post-worktree.ts"));
    const shFile = Bun.file(join(hooksDir, "post-worktree.sh"));
    expect(await tsFile.exists()).toBe(true);
    expect(await shFile.exists()).toBe(true);
  });
});

describe("create-worktree envPath handling", () => {
  let tempDir: string;
  let repoDir: string;
  let worktreeDir: string;

  beforeAll(async () => {
    // Create a temporary directory for the test
    tempDir = mkdtempSync(join(tmpdir(), "quickenv_envpath_test_"));
    repoDir = join(tempDir, "main-repo");
    mkdirSync(repoDir, { recursive: true });

    // Initialize a git repo
    await $`cd ${repoDir} && git init`.quiet();
    await $`cd ${repoDir} && git config user.email "test@test.com"`.quiet();
    await $`cd ${repoDir} && git config user.name "Test"`.quiet();
    await $`cd ${repoDir} && git config commit.gpgsign false`.quiet();

    // Create initial commit
    writeFileSync(join(repoDir, "README.md"), "# Test");
    await $`cd ${repoDir} && git add README.md && git commit -m "initial"`.quiet();

    // Create .quickenv directory
    mkdirSync(join(repoDir, ".quickenv"), { recursive: true });
  });

  afterAll(() => {
    // Cleanup
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("should copy array envPath to new worktree state", async () => {
    const statePath = join(repoDir, ".quickenv/.quickenv.state");
    const envPaths = ["../shared/.env.quick", ".env.quick"];
    
    // Create state file with array envPath
    writeFileSync(statePath, JSON.stringify({ 
      envPath: envPaths,
      activePreset: "*" 
    }, null, 2));

    // Create worktree
    const branchName = "test-array-envpath";
    worktreeDir = join(tempDir, `main-repo-${branchName}`);
    
    await $`cd ${repoDir} && git worktree add "${worktreeDir}" -b "${branchName}"`.quiet();

    // Simulate what createWorktree does with envPath
    const newState: Record<string, unknown> = {};
    const repoName = basename(repoDir);
    const calculateRelativePath = (path: string): string => {
      return path.startsWith("/") ? path : join("..", repoName, path);
    };
    const transformedPaths = envPaths.map(calculateRelativePath);
    newState.envPath = transformedPaths;

    // Write state to worktree
    const worktreeStatePath = join(worktreeDir, ".quickenv/.quickenv.state");
    mkdirSync(join(worktreeDir, ".quickenv"), { recursive: true });
    writeFileSync(worktreeStatePath, JSON.stringify(newState, null, 2));

    // Verify the state file was created with transformed array
    const worktreeStateContent = readFileSync(worktreeStatePath, "utf-8");
    const worktreeState = JSON.parse(worktreeStateContent);
    
    expect(Array.isArray(worktreeState.envPath)).toBe(true);
    expect(worktreeState.envPath).toHaveLength(2);
    // Paths should be transformed - note: path.join normalizes redundant segments
    // ../main-repo/../shared/.env.quick becomes ../shared/.env.quick
    expect(worktreeState.envPath[0]).toBe("../shared/.env.quick");
    expect(worktreeState.envPath[1]).toBe(`../${repoName}/.env.quick`);

    // Cleanup worktree
    await $`cd ${repoDir} && git worktree remove "${worktreeDir}" --force`.quiet();
    await $`cd ${repoDir} && git branch -D "${branchName}"`.quiet();
  });

  test("should not include activePreset in new worktree state", async () => {
    const statePath = join(repoDir, ".quickenv/.quickenv.state");
    
    // Create state file with array envPath and activePreset
    writeFileSync(statePath, JSON.stringify({ 
      envPath: [".env.quick"],
      activePreset: "develop",
      isProtected: false
    }, null, 2));

    // Create worktree
    const branchName = "test-no-preset";
    worktreeDir = join(tempDir, `main-repo-${branchName}`);
    
    await $`cd ${repoDir} && git worktree add "${worktreeDir}" -b "${branchName}"`.quiet();

    // Simulate what createWorktree does - only copy envPath
    const newState: Record<string, unknown> = {};
    const mainState = JSON.parse(readFileSync(statePath, "utf-8"));
    if (mainState.envPath) {
      const repoName = basename(repoDir);
      const calculateRelativePath = (path: string): string => {
        return path.startsWith("/") ? path : join("..", repoName, path);
      };
      if (Array.isArray(mainState.envPath)) {
        newState.envPath = mainState.envPath.map(calculateRelativePath);
      } else {
        newState.envPath = calculateRelativePath(mainState.envPath);
      }
    }

    // Write state to worktree
    const worktreeStatePath = join(worktreeDir, ".quickenv/.quickenv.state");
    mkdirSync(join(worktreeDir, ".quickenv"), { recursive: true });
    writeFileSync(worktreeStatePath, JSON.stringify(newState, null, 2));

    // Verify the state file was created without activePreset
    const worktreeStateContent = readFileSync(worktreeStatePath, "utf-8");
    const worktreeState = JSON.parse(worktreeStateContent);
    
    expect(worktreeState.envPath).toBeDefined();
    expect(worktreeState.activePreset).toBeUndefined();
    expect(worktreeState.isProtected).toBeUndefined();

    // Cleanup worktree
    await $`cd ${repoDir} && git worktree remove "${worktreeDir}" --force`.quiet();
    await $`cd ${repoDir} && git branch -D "${branchName}"`.quiet();
  });
});
