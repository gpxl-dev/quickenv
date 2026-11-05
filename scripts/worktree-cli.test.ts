import { expect, test } from "bun:test";
import { $ } from "bun";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cli = resolve(import.meta.dir, "../index.ts");
const standalone = resolve(import.meta.dir, "create-worktree.ts");

// Exercise closed stdin, preset activation, copy output, hooks, and failures
// before Git mutation. A timeout turns an accidental prompt into a test failure.
test("worktree CLI configures unattended worktrees and rejects unsafe requests", async () => {
  const temp = await mkdtemp(join(tmpdir(), "quickenv-worktree-cli-"));
  const repo = join(temp, "repo");
  const run = async (args: string[], entry = cli) => {
    const proc = Bun.spawn([process.execPath, entry, ...(entry === cli ? ["worktree"] : []), ...args], {
      cwd: repo, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      timeout: 10_000,
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    return { code, output: stdout + stderr };
  };
  try {
    await mkdir(join(repo, ".quickenv/hooks"), { recursive: true });
    await Bun.write(join(repo, "quickenv.yaml"), 'projects: ["."]\npresets:\n  production:\n    protected: true\n');
    await Bun.write(join(repo, ".gitignore"), ".quickenv/\n.env\nreferences/\n");
    await Bun.write(join(repo, ".worktreeinclude"), "references/**\n");
    await Bun.write(join(repo, ".quickenv/.env.quick.yaml"), 'local:\n  "*":\n    MODE: development\nproduction:\n  "*":\n    MODE: production\n');
    await Bun.write(join(repo, "references/api.md"), "reference content\n");
    await Bun.write(join(repo, ".quickenv/hooks/post-worktree.sh"), 'printf "%s %s" "$QUICKENV_PRESET" "$*" > "$WORKTREE_PATH/hook-preset.txt"\n');
    await $`git -C ${repo} init`.quiet();
    await $`git -C ${repo} add .`.quiet();
    await $`git -C ${repo} -c user.name=Test -c user.email=test@example.com -c commit.gpgsign=false commit -m initial`.quiet();

    for (const [args, message] of [
      [["missing-choice"], "--preset"],
      [["--preset", "local"], "branch"],
      [["conflict", "--preset", "local", "--skip-preset"], "cannot"],
      [["unknown", "--preset", "absent"], "not found"],
      [["protected", "--preset", "production", "--non-interactive"], "protected"],
    ] as const) {
      const result = await run([...args]);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain(message);
      expect((await $`git -C ${repo} worktree list --porcelain`.quiet()).text().match(/^worktree /gm)).toHaveLength(1);
    }

    const target = join(temp, "nested/feature");
    const result = await run(["feature", "--path", target, "--preset", "local", "--no-switch", "--", "--hook-flag", "value"]);
    expect(result.code).toBe(0);
    expect(result.output).toContain("Copied 1 file(s)");
    expect(result.output).not.toContain("references/api.md");
    expect(await Bun.file(join(target, "references/api.md")).text()).toBe("reference content\n");
    expect(await Bun.file(join(target, ".env")).text()).toContain("MODE=development");
    expect((await Bun.file(join(target, ".quickenv/.quickenv.state")).json()).activePreset).toBe("local");
    expect(await Bun.file(join(target, "hook-preset.txt")).text()).toBe("local --hook-flag value");

    const skipped = await run(["skip", "--skip-preset", "--verbose", "--non-interactive"], standalone);
    expect(skipped.code).toBe(0);
    expect(skipped.output).toContain("references/api.md");
    const skipTarget = join(temp, "skip");
    expect((await Bun.file(join(skipTarget, ".quickenv/.quickenv.state")).json()).activePreset).toBeUndefined();
    expect(await Bun.file(join(skipTarget, ".env")).exists()).toBe(false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}, 60_000);
