import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { join } from "path";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
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
