import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { performSwitch } from "./switch";
import { join } from "path";
import { mkdir, writeFile, rm } from "node:fs/promises";

describe("switch command", () => {
    const tmpDir = join(process.cwd(), "tmp_test_switch_" + Date.now());

    beforeAll(async () => {
        await mkdir(tmpDir, { recursive: true });
    });

    afterAll(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it("should use defaultTarget from config", async () => {
        // Setup
        const projectPath = join(tmpDir, "apps/web");
        const apiPath = join(tmpDir, "apps/api");
        await mkdir(projectPath, { recursive: true });
        await mkdir(apiPath, { recursive: true });
        
        const configPath = join(tmpDir, "quickenv.yaml");
        const configContent = `
defaultTarget: .env.development
projects:
  - apps/web
  - path: apps/api
    target: .env.custom
`;
        await writeFile(configPath, configContent);

        await mkdir(join(tmpDir, ".quickenv"), { recursive: true });
        const envQuickPath = join(tmpDir, ".quickenv/.env.quick");
        const envQuickContent = `
[dev]
API_URL=http://localhost:3000
`;
        await writeFile(envQuickPath, envQuickContent);

        // Run switch
        await performSwitch("dev", tmpDir);

        // Verify apps/web uses defaultTarget
        const webEnv = Bun.file(join(projectPath, ".env.development"));
        expect(await webEnv.exists()).toBe(true);
        expect(await webEnv.text()).toContain("API_URL=http://localhost:3000");

        // Verify apps/api uses explicit target
        const apiEnv = Bun.file(join(apiPath, ".env.custom"));
        expect(await apiEnv.exists()).toBe(true);
        expect(await apiEnv.text()).toContain("API_URL=http://localhost:3000");

        // Verify apps/api did NOT use defaultTarget
        const apiWrongEnv = Bun.file(join(apiPath, ".env.development"));
        expect(await apiWrongEnv.exists()).toBe(false);
    });

    it("should resolve variables for nested project paths", async () => {
        const projectPath = join(tmpDir, "apps/nested/web");
        await mkdir(projectPath, { recursive: true });
        
        const configPath = join(tmpDir, "quickenv.yaml");
        const configContent = `
projects:
  - apps/nested/web
`;
        await writeFile(configPath, configContent);

        const envQuickPath = join(tmpDir, ".quickenv/.env.quick");
        const envQuickContent = `
[apps/nested/web:dev]
NESTED_VAR=true
`;
        await mkdir(join(tmpDir, ".quickenv"), { recursive: true });
        await writeFile(envQuickPath, envQuickContent);

        await performSwitch("dev", tmpDir);

        const webEnv = Bun.file(join(projectPath, ".env"));
        expect(await webEnv.exists()).toBe(true);
        expect(await webEnv.text()).toContain("NESTED_VAR=true");
    });

    it("should allow preset to override target filename", async () => {
        const projectPath = join(tmpDir, "apps/prod-app");
        await mkdir(projectPath, { recursive: true });
        
        const configPath = join(tmpDir, "quickenv.yaml");
        const configContent = `
projects:
  - path: apps/prod-app
    target: .env.local
presets:
  production:
    target: .env.production
`;
        await writeFile(configPath, configContent);

        const envQuickPath = join(tmpDir, ".quickenv/.env.quick");
        const envQuickContent = `
[production]
DB_URL=postgres://prod
`;
        await mkdir(join(tmpDir, ".quickenv"), { recursive: true });
        await writeFile(envQuickPath, envQuickContent);

        await performSwitch("production", tmpDir);

        // Should use .env.production instead of .env.local
        const prodEnv = Bun.file(join(projectPath, ".env.production"));
        const localEnv = Bun.file(join(projectPath, ".env.local"));
        
        expect(await prodEnv.exists()).toBe(true);
        expect(await localEnv.exists()).toBe(false);
        expect(await prodEnv.text()).toContain("DB_URL=postgres://prod");

        // Verify state
        const stateFile = Bun.file(join(tmpDir, ".quickenv/.quickenv.state"));
        expect(await stateFile.exists()).toBe(true);
        const state = await stateFile.json();
        expect(state.activePreset).toBe("production");
        expect(state.isProtected).toBe(false); // In this test, protected was not true in config
    });

    it("should merge multiple env files with later files taking precedence", async () => {
        const projectPath = join(tmpDir, "apps/merged-app");
        const sharedDir = join(tmpDir, "shared");
        await mkdir(projectPath, { recursive: true });
        await mkdir(sharedDir, { recursive: true });
        
        const configPath = join(tmpDir, "quickenv.yaml");
        const configContent = `
projects:
  - apps/merged-app
`;
        await writeFile(configPath, configContent);

        // Create shared env file
        const sharedEnvPath = join(sharedDir, ".env.quick");
        const sharedEnvContent = `
[local]
SHARED_VAR=from_shared
OVERRIDE_VAR=original_value
API_KEY=shared_key
`;
        await writeFile(sharedEnvPath, sharedEnvContent);

        // Create local env file that overrides some values
        const localEnvPath = join(tmpDir, ".quickenv/.env.quick");
        const localEnvContent = `
[local]
OVERRIDE_VAR=overridden_value
LOCAL_VAR=only_local
`;
        await mkdir(join(tmpDir, ".quickenv"), { recursive: true });
        await writeFile(localEnvPath, localEnvContent);

        // Create state file with array envPath
        // State is at .quickenv/.quickenv.state, so paths are relative to tmpDir (repo root)
        const statePath = join(tmpDir, ".quickenv/.quickenv.state");
        const stateContent = JSON.stringify({
            envPath: ["shared/.env.quick", ".quickenv/.env.quick"]
        });
        await writeFile(statePath, stateContent);

        await performSwitch("local", tmpDir);

        // Verify merged result
        const envFile = Bun.file(join(projectPath, ".env"));
        expect(await envFile.exists()).toBe(true);
        const envContent = await envFile.text();
        
        // Variables from shared file should be present
        expect(envContent).toContain("SHARED_VAR=from_shared");
        expect(envContent).toContain("API_KEY=shared_key");
        
        // Local override should take precedence
        expect(envContent).toContain("OVERRIDE_VAR=overridden_value");
        expect(envContent).not.toContain("OVERRIDE_VAR=original_value");
        
        // Local-only variables should be present
        expect(envContent).toContain("LOCAL_VAR=only_local");
    });

    it("should handle single envPath as string (backward compatibility)", async () => {
        const projectPath = join(tmpDir, "apps/single-app");
        await mkdir(projectPath, { recursive: true });
        
        const configPath = join(tmpDir, "quickenv.yaml");
        const configContent = `
projects:
  - apps/single-app
`;
        await writeFile(configPath, configContent);

        const envQuickPath = join(tmpDir, ".quickenv/.env.quick");
        const envQuickContent = `
[local]
SINGLE_VAR=value
`;
        await mkdir(join(tmpDir, ".quickenv"), { recursive: true });
        await writeFile(envQuickPath, envQuickContent);

        // Create state file with string envPath
        const statePath = join(tmpDir, ".quickenv/.quickenv.state");
        const stateContent = JSON.stringify({
            envPath: ".quickenv/.env.quick"
        });
        await writeFile(statePath, stateContent);

        await performSwitch("local", tmpDir);

        const envFile = Bun.file(join(projectPath, ".env"));
        expect(await envFile.exists()).toBe(true);
        expect(await envFile.text()).toContain("SINGLE_VAR=value");
    });

    it("should handle absolute paths in envPath array", async () => {
        const projectPath = join(tmpDir, "apps/abs-app");
        const sharedDir = join(tmpDir, "shared-abs");
        await mkdir(projectPath, { recursive: true });
        await mkdir(sharedDir, { recursive: true });
        
        const configPath = join(tmpDir, "quickenv.yaml");
        const configContent = `
projects:
  - apps/abs-app
`;
        await writeFile(configPath, configContent);

        // Create shared env file with absolute path
        const sharedEnvPath = join(sharedDir, ".env.quick");
        const sharedEnvContent = `
[local]
ABS_SHARED=from_abs_shared
`;
        await writeFile(sharedEnvPath, sharedEnvContent);

        // Create local env file
        const localEnvPath = join(tmpDir, ".quickenv/.env.quick");
        const localEnvContent = `
[local]
ABS_LOCAL=from_abs_local
`;
        await mkdir(join(tmpDir, ".quickenv"), { recursive: true });
        await writeFile(localEnvPath, localEnvContent);

        // Create state file with absolute path in array
        const statePath = join(tmpDir, ".quickenv/.quickenv.state");
        const stateContent = JSON.stringify({
            envPath: [sharedEnvPath, ".quickenv/.env.quick"]
        });
        await writeFile(statePath, stateContent);

        await performSwitch("local", tmpDir);

        const envFile = Bun.file(join(projectPath, ".env"));
        expect(await envFile.exists()).toBe(true);
        const envContent = await envFile.text();
        
        expect(envContent).toContain("ABS_SHARED=from_abs_shared");
        expect(envContent).toContain("ABS_LOCAL=from_abs_local");
    });
});
