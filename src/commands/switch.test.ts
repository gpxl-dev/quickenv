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

        const envQuickPath = join(tmpDir, ".env.quick");
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

        const envQuickPath = join(tmpDir, ".env.quick");
        const envQuickContent = `
[apps/nested/web:dev]
NESTED_VAR=true
`;
        await writeFile(envQuickPath, envQuickContent);

        await performSwitch("dev", tmpDir);

        const webEnv = Bun.file(join(projectPath, ".env"));
        expect(await webEnv.exists()).toBe(true);
        expect(await webEnv.text()).toContain("NESTED_VAR=true");
    });
});
