import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolveEnvQuickPath, loadMergedEnvQuick, loadState, saveState } from "./config";
import { join } from "path";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "os";

describe("resolveEnvQuickPath", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "quickenv-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("should return default path when no envPath in state", async () => {
    await mkdir(join(tmpDir, ".quickenv"), { recursive: true });
    const statePath = join(tmpDir, ".quickenv/.quickenv.state");
    await writeFile(statePath, JSON.stringify({}));

    const result = await resolveEnvQuickPath(statePath);

    expect(result.path).toBe(join(tmpDir, ".quickenv/.env.quick"));
    expect(result.paths).toEqual([join(tmpDir, ".quickenv/.env.quick")]);
    expect(result.isCustom).toBe(false);
  });

  it("should handle single string envPath", async () => {
    await mkdir(join(tmpDir, ".quickenv"), { recursive: true });
    const customEnvPath = join(tmpDir, "custom/.env.quick");
    await mkdir(join(tmpDir, "custom"), { recursive: true });
    await writeFile(customEnvPath, "TEST=value");

    const statePath = join(tmpDir, ".quickenv/.quickenv.state");
    await writeFile(statePath, JSON.stringify({ envPath: "custom/.env.quick" }));

    const result = await resolveEnvQuickPath(statePath);

    expect(result.path).toBe(customEnvPath);
    expect(result.paths).toEqual([customEnvPath]);
    expect(result.isCustom).toBe(true);
  });

  it("should handle array envPath with relative paths", async () => {
    await mkdir(join(tmpDir, ".quickenv"), { recursive: true });
    await mkdir(join(tmpDir, "shared"), { recursive: true });
    
    const sharedPath = join(tmpDir, "shared/.env.quick");
    const localPath = join(tmpDir, ".quickenv/.env.quick");
    
    await writeFile(sharedPath, "SHARED=value");
    await writeFile(localPath, "LOCAL=value");

    const statePath = join(tmpDir, ".quickenv/.quickenv.state");
    await writeFile(statePath, JSON.stringify({ 
      envPath: ["shared/.env.quick", ".quickenv/.env.quick"] 
    }));

    const result = await resolveEnvQuickPath(statePath);

    expect(result.paths).toEqual([sharedPath, localPath]);
    expect(result.path).toBe(localPath); // Last one is the primary
    expect(result.isCustom).toBe(true);
  });

  it("should handle array envPath with absolute paths", async () => {
    await mkdir(join(tmpDir, ".quickenv"), { recursive: true });
    await mkdir(join(tmpDir, "shared"), { recursive: true });
    
    const sharedPath = join(tmpDir, "shared/.env.quick");
    const localPath = join(tmpDir, ".quickenv/.env.quick");
    
    await writeFile(sharedPath, "SHARED=value");
    await writeFile(localPath, "LOCAL=value");

    const statePath = join(tmpDir, ".quickenv/.quickenv.state");
    await writeFile(statePath, JSON.stringify({ 
      envPath: [sharedPath, ".quickenv/.env.quick"] 
    }));

    const result = await resolveEnvQuickPath(statePath);

    expect(result.paths).toEqual([sharedPath, localPath]);
    expect(result.isCustom).toBe(true);
  });

  it("should filter out non-existent paths and fall back to default", async () => {
    await mkdir(join(tmpDir, ".quickenv"), { recursive: true });
    const defaultPath = join(tmpDir, ".quickenv/.env.quick");
    await writeFile(defaultPath, "DEFAULT=value");

    const statePath = join(tmpDir, ".quickenv/.quickenv.state");
    const nonExistentPath = join(tmpDir, "nonexistent/.env.quick");
    await writeFile(statePath, JSON.stringify({ 
      envPath: ["nonexistent/.env.quick"] 
    }));

    const result = await resolveEnvQuickPath(statePath);

    expect(result.path).toBe(defaultPath);
    expect(result.paths).toEqual([defaultPath]);
    expect(result.isCustom).toBe(false);
    expect(result.fallbackFrom).toBe(nonExistentPath);
  });

  it("should handle mixed existing and non-existent paths in array", async () => {
    await mkdir(join(tmpDir, ".quickenv"), { recursive: true });
    await mkdir(join(tmpDir, "shared"), { recursive: true });
    
    const sharedPath = join(tmpDir, "shared/.env.quick");
    const localPath = join(tmpDir, ".quickenv/.env.quick");
    const nonExistentPath = join(tmpDir, "nonexistent/.env.quick");
    
    await writeFile(sharedPath, "SHARED=value");
    await writeFile(localPath, "LOCAL=value");

    const statePath = join(tmpDir, ".quickenv/.quickenv.state");
    await writeFile(statePath, JSON.stringify({ 
      envPath: ["shared/.env.quick", "nonexistent/.env.quick", ".quickenv/.env.quick"] 
    }));

    const result = await resolveEnvQuickPath(statePath);

    // Should only include existing paths
    expect(result.paths).toEqual([sharedPath, localPath]);
    expect(result.path).toBe(localPath);
  });
});

describe("loadMergedEnvQuick", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "quickenv-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("should return content of single file", async () => {
    const envPath = join(tmpDir, ".env.quick");
    const content = `
[local]
VAR1=value1
VAR2=value2
`;
    await writeFile(envPath, content);

    const result = await loadMergedEnvQuick({
      path: envPath,
      paths: [envPath],
      isCustom: false
    });

    // Parse and compare sections since serialize may format differently
    const { parseEnvQuick } = await import("./parser");
    const resultSections = parseEnvQuick(result);
    const expectedSections = parseEnvQuick(content);
    
    expect(resultSections).toEqual(expectedSections);
  });

  it("should merge multiple files with later files taking precedence", async () => {
    const file1 = join(tmpDir, "shared.env.quick");
    const file2 = join(tmpDir, "local.env.quick");

    await writeFile(file1, `
[local]
SHARED_VAR=from_shared
OVERRIDE_VAR=original_value
`);

    await writeFile(file2, `
[local]
OVERRIDE_VAR=overridden_value
LOCAL_VAR=from_local
`);

    const result = await loadMergedEnvQuick({
      path: file2,
      paths: [file1, file2],
      isCustom: true
    });

    const { parseEnvQuick } = await import("./parser");
    const sections = parseEnvQuick(result);
    const localSection = sections.find(s => s.tags.includes("local"));

    expect(localSection).toBeDefined();
    expect(localSection!.variables["SHARED_VAR"]).toBe("from_shared");
    expect(localSection!.variables["OVERRIDE_VAR"]).toBe("overridden_value");
    expect(localSection!.variables["LOCAL_VAR"]).toBe("from_local");
  });

  it("should merge multiple sections across files", async () => {
    const file1 = join(tmpDir, "shared.env.quick");
    const file2 = join(tmpDir, "local.env.quick");

    await writeFile(file1, `
[local]
VAR1=shared_local

[production]
VAR2=shared_prod
`);

    await writeFile(file2, `
[local]
VAR3=local_only

[staging]
VAR4=local_staging
`);

    const result = await loadMergedEnvQuick({
      path: file2,
      paths: [file1, file2],
      isCustom: true
    });

    const { parseEnvQuick } = await import("./parser");
    const sections = parseEnvQuick(result);

    // Should have local, production, and staging sections
    const localSection = sections.find(s => s.tags.includes("local"));
    const prodSection = sections.find(s => s.tags.includes("production"));
    const stagingSection = sections.find(s => s.tags.includes("staging"));

    expect(localSection).toBeDefined();
    expect(localSection!.variables["VAR1"]).toBe("shared_local");
    expect(localSection!.variables["VAR3"]).toBe("local_only");
    
    expect(prodSection).toBeDefined();
    expect(prodSection!.variables["VAR2"]).toBe("shared_prod");
    
    expect(stagingSection).toBeDefined();
    expect(stagingSection!.variables["VAR4"]).toBe("local_staging");
  });

  it("should handle global variables in merged files", async () => {
    const file1 = join(tmpDir, "shared.env.quick");
    const file2 = join(tmpDir, "local.env.quick");

    await writeFile(file1, `
GLOBAL_VAR=from_shared_global
`);

    await writeFile(file2, `
GLOBAL_VAR=from_local_global
LOCAL_GLOBAL=only_local
`);

    const result = await loadMergedEnvQuick({
      path: file2,
      paths: [file1, file2],
      isCustom: true
    });

    const { parseEnvQuick } = await import("./parser");
    const sections = parseEnvQuick(result);
    const globalSection = sections.find(s => s.tags.length === 0);

    expect(globalSection).toBeDefined();
    // Later file should override
    expect(globalSection!.variables["GLOBAL_VAR"]).toBe("from_local_global");
    expect(globalSection!.variables["LOCAL_GLOBAL"]).toBe("only_local");
  });
});
