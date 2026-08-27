import { afterEach, describe, expect, test } from "bun:test";
import { $ } from "bun";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  performExtract,
  replaceSourceInState,
} from "./extract";

const tempDirs: string[] = [];

async function makeRoot(prefix = "quickenv-extract-") {
  const tempDir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(tempDir);
  const rootDir = join(tempDir, "repo");
  const sourcePath = join(rootDir, ".quickenv/.env.quick.yaml");
  await mkdir(join(rootDir, ".quickenv"), { recursive: true });
  await writeFile(join(rootDir, "quickenv.yaml"), "projects: []\n");
  await writeFile(sourcePath, "local:\n  '*':\n    TOKEN: fake-secret-value\n", {
    mode: 0o600,
  });
  return { tempDir, rootDir, sourcePath };
}

function prompts(
  destination: string,
  overrides: Partial<{
    confirmDestination: boolean | null;
    confirmLinkOthers: boolean | null;
    selected: string[] | null;
    confirmDistinctSource: boolean | null;
  }> = {},
) {
  return {
    destinationDirectory: async () => destination,
    confirmDestination: async () => overrides.confirmDestination ?? false,
    confirmLinkOthers: async () => overrides.confirmLinkOthers ?? false,
    selectLinkDirectories: async () => overrides.selected ?? [],
    confirmDistinctSource: async () => overrides.confirmDistinctSource ?? false,
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("quickenv extract", () => {
  test("moves the source, stores a canonical path, and keeps output secret-safe", async () => {
    const { tempDir, rootDir, sourcePath } = await makeRoot();
    const destinationDir = join(tempDir, "shared");
    const configBefore = await readFile(join(rootDir, "quickenv.yaml"));
    await writeFile(
      join(rootDir, ".quickenv/.quickenv.state"),
      JSON.stringify({
        activePreset: "local",
        isProtected: false,
        futureField: { keep: true },
      }),
    );
    const messages: string[] = [];

    const result = await performExtract(
      rootDir,
      prompts(destinationDir),
      {
        info: (message) => messages.push(message),
        success: (message) => messages.push(message),
        warn: (message) => messages.push(message),
      },
    );

    const destinationPath = join(await realpath(destinationDir), ".env.quick.yaml");
    expect(result).toMatchObject({
      status: "extracted",
      destinationPath,
      sourceRemoved: true,
    });
    expect(await Bun.file(sourcePath).exists()).toBe(false);
    expect(await readFile(destinationPath, "utf8")).toBe(
      "local:\n  '*':\n    TOKEN: fake-secret-value\n",
    );
    expect((await stat(destinationPath)).mode & 0o777).toBe(0o600);
    expect((await stat(join(rootDir, ".quickenv/.quickenv.state"))).mode & 0o777).toBe(0o600);
    expect(
      JSON.parse(await readFile(join(rootDir, ".quickenv/.quickenv.state"), "utf8")),
    ).toEqual({
      activePreset: "local",
      isProtected: false,
      futureField: { keep: true },
      envPath: destinationPath,
    });
    expect(await readFile(join(rootDir, "quickenv.yaml"))).toEqual(configBefore);
    expect(messages.join("\n")).not.toContain("fake-secret-value");
  });

  test("cancels without replacing a distinct destination", async () => {
    const { tempDir, rootDir, sourcePath } = await makeRoot();
    const destinationDir = join(tempDir, "shared");
    const destinationPath = join(destinationDir, ".env.quick.yaml");
    await mkdir(destinationDir);
    await writeFile(destinationPath, "existing: distinct\n", { mode: 0o640 });

    const result = await performExtract(
      rootDir,
      prompts(destinationDir, { confirmDestination: false }),
    );

    expect(result.status).toBe("cancelled");
    expect(await Bun.file(sourcePath).exists()).toBe(true);
    expect(await readFile(destinationPath, "utf8")).toBe("existing: distinct\n");
    expect(await Bun.file(join(rootDir, ".quickenv/.quickenv.state")).exists()).toBe(false);
  });

  test("reuses an identical destination and enforces mode 0600", async () => {
    const { tempDir, rootDir, sourcePath } = await makeRoot();
    const destinationDir = join(tempDir, "shared");
    const destinationPath = join(destinationDir, ".env.quick.yaml");
    await mkdir(destinationDir);
    await writeFile(destinationPath, await readFile(sourcePath), { mode: 0o644 });

    const result = await performExtract(
      rootDir,
      prompts(destinationDir, { confirmDestination: true }),
    );

    expect(result.status).toBe("extracted");
    expect((await stat(destinationPath)).mode & 0o777).toBe(0o600);
    expect(await Bun.file(sourcePath).exists()).toBe(false);
  });

  test("replaces a distinct destination after confirmation", async () => {
    const { tempDir, rootDir, sourcePath } = await makeRoot();
    const destinationDir = join(tempDir, "shared");
    const destinationPath = join(destinationDir, ".env.quick.yaml");
    await mkdir(destinationDir);
    await writeFile(destinationPath, "replace: this-file\n", { mode: 0o640 });
    const sourceContent = await readFile(sourcePath);

    const result = await performExtract(
      rootDir,
      prompts(destinationDir, { confirmDestination: true }),
    );

    expect(result.status).toBe("extracted");
    expect(await readFile(destinationPath)).toEqual(sourceContent);
    expect((await stat(destinationPath)).mode & 0o777).toBe(0o600);
    expect(await Bun.file(sourcePath).exists()).toBe(false);
  });

  test("restores a replaced destination when the state write fails", async () => {
    const { tempDir, rootDir, sourcePath } = await makeRoot();
    const destinationDir = join(tempDir, "shared");
    const destinationPath = join(destinationDir, ".env.quick.yaml");
    await mkdir(destinationDir);
    await writeFile(destinationPath, "keep: this-file\n", { mode: 0o640 });

    await expect(
      performExtract(
        rootDir,
        prompts(destinationDir, { confirmDestination: true }),
        undefined,
        { saveState: async () => { throw new Error("simulated state failure"); } },
      ),
    ).rejects.toThrow("simulated state failure");

    expect(await Bun.file(sourcePath).exists()).toBe(true);
    expect(await readFile(destinationPath, "utf8")).toBe("keep: this-file\n");
    expect((await stat(destinationPath)).mode & 0o777).toBe(0o640);
  });

  test("retains a concurrent destination update while restoring a collision", async () => {
    const { tempDir, rootDir, sourcePath } = await makeRoot();
    const destinationDir = join(tempDir, "shared");
    const destinationPath = join(destinationDir, ".env.quick.yaml");
    await mkdir(destinationDir);
    await writeFile(destinationPath, "original: destination\n", { mode: 0o600 });

    await expect(
      performExtract(
        rootDir,
        prompts(destinationDir, { confirmDestination: true }),
        undefined,
        {
          saveState: async () => {
            await writeFile(destinationPath, "concurrent: update\n", { mode: 0o600 });
            throw new Error("simulated state failure");
          },
        },
      ),
    ).rejects.toThrow("simulated state failure");

    expect(await readFile(destinationPath, "utf8")).toBe("original: destination\n");
    const rollbackFile = (await readdir(destinationDir)).find((name) =>
      name.includes(".rollback-"),
    );
    expect(rollbackFile).toBeDefined();
    expect(await readFile(join(destinationDir, rollbackFile!), "utf8")).toBe(
      "concurrent: update\n",
    );
    expect(await Bun.file(sourcePath).exists()).toBe(true);
  });

  test("restores an identical destination mode when the state write fails", async () => {
    const { tempDir, rootDir, sourcePath } = await makeRoot();
    const destinationDir = join(tempDir, "shared");
    const destinationPath = join(destinationDir, ".env.quick.yaml");
    await mkdir(destinationDir);
    await writeFile(destinationPath, await readFile(sourcePath), { mode: 0o644 });

    await expect(
      performExtract(
        rootDir,
        prompts(destinationDir, { confirmDestination: true }),
        undefined,
        { saveState: async () => { throw new Error("simulated state failure"); } },
      ),
    ).rejects.toThrow("simulated state failure");

    expect((await stat(destinationPath)).mode & 0o777).toBe(0o644);
    expect(await Bun.file(sourcePath).exists()).toBe(true);
  });

  test("rejects a source reached through a symlinked parent", async () => {
    const { tempDir, rootDir } = await makeRoot();
    const externalDir = join(tempDir, "external-source");
    const externalSource = join(externalDir, ".env.quick.yaml");
    await rm(join(rootDir, ".quickenv"), { recursive: true });
    await mkdir(externalDir);
    await writeFile(externalSource, "local: {}\n", { mode: 0o600 });
    await symlink(externalDir, join(rootDir, ".quickenv"));

    await expect(
      performExtract(rootDir, prompts(join(tempDir, "shared"))),
    ).rejects.toThrow("symlinked path");
    expect(await Bun.file(externalSource).exists()).toBe(true);
  });

  test("rejects a destination inside the current worktree", async () => {
    const { rootDir, sourcePath } = await makeRoot();

    await expect(
      performExtract(rootDir, prompts(join(rootDir, "shared"))),
    ).rejects.toThrow("outside the current worktree");
    expect(await Bun.file(sourcePath).exists()).toBe(true);
    expect(await Bun.file(join(rootDir, ".quickenv/.quickenv.state")).exists()).toBe(false);
  });

  test("rejects a legacy-only active source", async () => {
    const { tempDir, rootDir, sourcePath } = await makeRoot();
    const legacyPath = join(rootDir, ".quickenv/.env.quick");
    await rm(sourcePath);
    await writeFile(legacyPath, "[local]\nTOKEN=fake-value\n", { mode: 0o600 });

    await expect(
      performExtract(rootDir, prompts(join(tempDir, "shared"))),
    ).rejects.toThrow("active YAML source");
    expect(await Bun.file(legacyPath).exists()).toBe(true);
  });

  test("keeps both verified copies when local removal fails", async () => {
    const { tempDir, rootDir, sourcePath } = await makeRoot();
    const destinationDir = join(tempDir, "shared");

    const result = await performExtract(
      rootDir,
      prompts(destinationDir),
      undefined,
      { removeSource: async () => { throw new Error("simulated removal failure"); } },
    );

    expect(result.sourceRemoved).toBe(false);
    expect(await Bun.file(sourcePath).exists()).toBe(true);
    expect(await Bun.file(result.destinationPath!).exists()).toBe(true);
    expect(
      JSON.parse(await readFile(join(rootDir, ".quickenv/.quickenv.state"), "utf8")).envPath,
    ).toBe(result.destinationPath);
  });

  test("retains a source changed while state is being saved", async () => {
    const { tempDir, rootDir, sourcePath } = await makeRoot();
    const updatedContent = "local:\n  '*':\n    TOKEN: changed-during-extract\n";

    const result = await performExtract(
      rootDir,
      prompts(join(tempDir, "shared")),
      undefined,
      {
        saveState: async (state, path) => {
          await writeFile(path!, JSON.stringify(state));
          await writeFile(sourcePath, updatedContent, { mode: 0o600 });
        },
      },
    );

    expect(result.sourceRemoved).toBe(false);
    expect(await readFile(sourcePath, "utf8")).toBe(updatedContent);
    expect(await readFile(result.destinationPath!, "utf8")).not.toBe(updatedContent);
  });

  test("preserves source ordering when replacing the active path", () => {
    expect(
      replaceSourceInState(
        { envPath: ["shared/base.yaml", ".quickenv/.env.quick.yaml"] },
        "/repo",
        "/repo/.quickenv/.env.quick.yaml",
        "/secrets/.env.quick.yaml",
      ),
    ).toEqual({
      envPath: ["shared/base.yaml", "/secrets/.env.quick.yaml"],
    });
  });
});

describe("quickenv extract linking", () => {
  async function makeGitWorktrees() {
    const setup = await makeRoot("quickenv-extract-link-");
    await writeFile(join(setup.rootDir, ".gitignore"), ".quickenv\n");
    await $`git -C ${setup.rootDir} init`.quiet();
    await $`git -C ${setup.rootDir} config user.email test@example.com`.quiet();
    await $`git -C ${setup.rootDir} config user.name Test`.quiet();
    await $`git -C ${setup.rootDir} add quickenv.yaml .gitignore`.quiet();
    await $`git -C ${setup.rootDir} commit -m initial`.quiet();
    const linkedRoot = join(setup.tempDir, "linked");
    await $`git -C ${setup.rootDir} worktree add -b linked ${linkedRoot}`.quiet();
    await mkdir(join(linkedRoot, ".quickenv"), { recursive: true });
    await writeFile(
      join(linkedRoot, ".quickenv/.env.quick.yaml"),
      "local:\n  '*':\n    TOKEN: another-fake-value\n",
      { mode: 0o600 },
    );
    return { ...setup, linkedRoot };
  }

  test("does not relink a selected worktree with a distinct source without confirmation", async () => {
    const { tempDir, rootDir, linkedRoot } = await makeGitWorktrees();
    const result = await performExtract(
      rootDir,
      prompts(join(tempDir, "shared"), {
        confirmLinkOthers: true,
        selected: [linkedRoot],
        confirmDistinctSource: false,
      }),
    );

    expect(result.skipped).toEqual([linkedRoot]);
    expect(await Bun.file(join(linkedRoot, ".quickenv/.quickenv.state")).exists()).toBe(false);
    expect(await Bun.file(join(linkedRoot, ".quickenv/.env.quick.yaml")).exists()).toBe(true);
  });

  test("removes an identical local source after linking", async () => {
    const { tempDir, rootDir, sourcePath, linkedRoot } = await makeGitWorktrees();
    const linkedSource = join(linkedRoot, ".quickenv/.env.quick.yaml");
    await writeFile(linkedSource, await readFile(sourcePath), { mode: 0o600 });

    const result = await performExtract(
      rootDir,
      prompts(join(tempDir, "shared"), {
        confirmLinkOthers: true,
        selected: [linkedRoot],
      }),
    );

    expect(result.linked).toEqual([linkedRoot]);
    expect(await Bun.file(linkedSource).exists()).toBe(false);
  });

  test("removes an identical custom active source after linking", async () => {
    const { tempDir, rootDir, sourcePath, linkedRoot } = await makeGitWorktrees();
    const defaultSource = join(linkedRoot, ".quickenv/.env.quick.yaml");
    const customSource = join(linkedRoot, ".quickenv/custom.env.quick.yaml");
    await rm(defaultSource);
    await writeFile(customSource, await readFile(sourcePath), { mode: 0o600 });
    await writeFile(
      join(linkedRoot, ".quickenv/.quickenv.state"),
      JSON.stringify({ envPath: ".quickenv/custom.env.quick.yaml" }),
    );

    const result = await performExtract(
      rootDir,
      prompts(join(tempDir, "shared"), {
        confirmLinkOthers: true,
        selected: [linkedRoot],
      }),
    );

    expect(result.linked).toEqual([linkedRoot]);
    expect(await Bun.file(customSource).exists()).toBe(false);
  });

  test("links a confirmed worktree and leaves its distinct local source intact", async () => {
    const { tempDir, rootDir, linkedRoot } = await makeGitWorktrees();
    const result = await performExtract(
      rootDir,
      prompts(join(tempDir, "shared"), {
        confirmLinkOthers: true,
        selected: [linkedRoot],
        confirmDistinctSource: true,
      }),
    );

    expect(result.linked).toEqual([linkedRoot]);
    const linkedState = JSON.parse(
      await readFile(join(linkedRoot, ".quickenv/.quickenv.state"), "utf8"),
    );
    expect(linkedState.envPath).toBe(result.destinationPath);
    expect(await Bun.file(join(linkedRoot, ".quickenv/.env.quick.yaml")).exists()).toBe(true);
  });
});
