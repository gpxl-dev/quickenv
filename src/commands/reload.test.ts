import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { performSwitch } from "./switch";
import { reloadCommand } from "./reload";
import { join } from "path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { saveState } from "../core/config";

describe("reload command", () => {
    const tmpDir = join(process.cwd(), "tmp_test_reload_" + Date.now());

    beforeAll(async () => {
        await mkdir(tmpDir, { recursive: true });
    });

    afterAll(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it("should reload the active preset from state", async () => {
        // Setup
        const projectPath = join(tmpDir, "apps/web");
        await mkdir(projectPath, { recursive: true });
        
        const configPath = join(tmpDir, "quickenv.yaml");
        const configContent = `
projects:
  - apps/web
`;
        await writeFile(configPath, configContent);

        const envQuickPath = join(tmpDir, ".env.quick");
        const envQuickContent = `
[dev]
VAR=old
`;
        await writeFile(envQuickPath, envQuickContent);

        const statePath = join(tmpDir, ".quickenv.state");
        await saveState({ activePreset: "dev" }, statePath);

        // Change current directory to tmpDir to simulate running the command there
        const originalCwd = process.cwd();
        process.chdir(tmpDir);

        try {
            // First apply with "old"
            await performSwitch("dev", tmpDir);
            let webEnv = Bun.file(join(projectPath, ".env"));
            expect(await webEnv.text()).toContain("VAR=old");

            // Change the values in .env.quick
            await writeFile(envQuickPath, `
[dev]
VAR=new
`);

            // Run reload via the action (mocking commander action)
            // @ts-ignore - action is private but we can get it from the command object
            await reloadCommand._actionHandler([]);

            // Verify reload updated the file
            webEnv = Bun.file(join(projectPath, ".env"));
            expect(await webEnv.text()).toContain("VAR=new");
        } finally {
            process.chdir(originalCwd);
        }
    });

    it("should fail if no active preset is found", async () => {
        const originalCwd = process.cwd();
        const emptyTmpDir = join(tmpDir, "empty");
        await mkdir(emptyTmpDir, { recursive: true });
        process.chdir(emptyTmpDir);

        const mockExit = console.error;
        let errorCalled = false;
        console.error = (...args) => {
            if (args[0].includes("No active preset found")) {
                errorCalled = true;
            }
        };

        const originalExit = process.exit;
        // @ts-ignore
        process.exit = (code) => {
            throw new Error(`exit ${code}`);
        };

        try {
            // @ts-ignore
            await reloadCommand._actionHandler([]);
        } catch (e: any) {
            expect(e.message).toBe("exit 1");
        } finally {
            console.error = mockExit;
            process.exit = originalExit;
            process.chdir(originalCwd);
        }
        
        expect(errorCalled).toBe(true);
    });
});
