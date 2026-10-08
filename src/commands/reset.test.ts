import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cli = resolve(import.meta.dir, "../../index.ts");
let root: string;
const original = "TEMPORARY=keep\n";
const state = JSON.stringify({ activePreset: "local", custom: "preserve" });

async function runReset(...args: string[]) {
  const child = Bun.spawn([process.execPath, cli, "reset", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, output: stdout + stderr };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "quickenv-reset-"));
  await Bun.write(join(root, "quickenv.yaml"), `
defaultTarget: .env.local
projects:
  - apps/web
  - path: packages/api
    target: .env.custom
`);
  await Bun.write(join(root, ".quickenv/.quickenv.state"), state);
  await Bun.write(join(root, ".quickenv/.env.quick.yaml"), `
base:
  "*":
    COMMON: inherited
local:
  extends: base
  apps/web:
    APP: web
  packages/api:
    APP: api
`);
  await Bun.write(join(root, "apps/web/.env.local"), original);
  await Bun.write(join(root, "packages/api/.env.custom"), original);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("reset command", () => {
  for (const selector of ["apps/web", "web", "apps/we"]) {
    it(`resets only the app selected by '${selector}'`, async () => {
      expect((await runReset(selector)).code).toBe(0);
      expect(await Bun.file(join(root, "apps/web/.env.local")).text())
        .toBe("COMMON=inherited\nAPP=web\n");
      expect(await Bun.file(join(root, "packages/api/.env.custom")).text()).toBe(original);
      expect(await Bun.file(join(root, ".quickenv/.quickenv.state")).text()).toBe(state);
    });
  }

  it("resets a package using its configured target", async () => {
    expect((await runReset("api")).code).toBe(0);
    expect(await Bun.file(join(root, "packages/api/.env.custom")).text())
      .toBe("COMMON=inherited\nAPP=api\n");
    expect(await Bun.file(join(root, "apps/web/.env.local")).text()).toBe(original);
  });

  it("honors the preset target over the project target", async () => {
    const config = Bun.file(join(root, "quickenv.yaml"));
    await Bun.write(config, await config.text() + "presets:\n  local:\n    target: .env.preset\n");
    expect((await runReset("api")).code).toBe(0);
    expect(await Bun.file(join(root, "packages/api/.env.preset")).text())
      .toBe("COMMON=inherited\nAPP=api\n");
    expect(await Bun.file(join(root, "packages/api/.env.custom")).text()).toBe(original);
    expect(await Bun.file(join(root, "apps/web/.env.preset")).exists()).toBe(false);
  });

  it("still resets every project when no selector is given", async () => {
    expect((await runReset()).code).toBe(0);
    expect(await Bun.file(join(root, "apps/web/.env.local")).text()).toContain("APP=web");
    expect(await Bun.file(join(root, "packages/api/.env.custom")).text()).toContain("APP=api");
  });

  for (const selector of ["missing", "a", ""]) {
    it(`rejects invalid selector '${selector}' without writing files`, async () => {
      const result = await runReset(selector);
      expect(result.code).toBe(1);
      expect(result.output).toContain(selector === "a" ? "Ambiguous project" : "No project matches");
      expect(await Bun.file(join(root, "apps/web/.env.local")).text()).toBe(original);
      expect(await Bun.file(join(root, "packages/api/.env.custom")).text()).toBe(original);
      expect(await Bun.file(join(root, ".quickenv/.quickenv.state")).text()).toBe(state);
    });
  }

  it("rejects ambiguous basenames but accepts an exact path", async () => {
    const config = Bun.file(join(root, "quickenv.yaml"));
    await Bun.write(config, await config.text() + "  - packages/web\n");
    await Bun.write(join(root, "packages/web/.env.local"), original);
    const result = await runReset("web");
    expect(result.code).toBe(1);
    expect(result.output).toContain("Ambiguous project");
    expect(await Bun.file(join(root, "apps/web/.env.local")).text()).toBe(original);
    expect((await runReset("apps/web")).code).toBe(0);
    expect(await Bun.file(join(root, "packages/web/.env.local")).text()).toBe(original);
  });

  it("requires an active preset", async () => {
    await Bun.write(join(root, ".quickenv/.quickenv.state"), "{}");
    const result = await runReset("web");
    expect(result.code).toBe(1);
    expect(result.output).toContain("No active preset");
    expect(await Bun.file(join(root, "apps/web/.env.local")).text()).toBe(original);
  });
});
