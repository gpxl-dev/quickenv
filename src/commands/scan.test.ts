import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { performScan } from "./scan";
import { join } from "path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { loadConfig } from "../core/config";
import { parseEnvQuick } from "../core/parser";

describe("scan command", () => {
    const tmpDir = join(process.cwd(), "tmp_test_scan_" + Date.now());

    beforeAll(async () => {
        await mkdir(tmpDir, { recursive: true });
    });

    afterAll(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it("should find .env files and update config", async () => {
        // Setup
        await mkdir(join(tmpDir, "apps/web"), { recursive: true });
        await mkdir(join(tmpDir, "apps/api"), { recursive: true });
        
        await writeFile(join(tmpDir, "apps/web/.env.local"), "WEB_VAR=123\nSHARED=true");
        await writeFile(join(tmpDir, "apps/api/.env.production"), "API_KEY=secret");
        await writeFile(join(tmpDir, ".env"), "ROOT_VAR=root");
        await writeFile(join(tmpDir, ".gitignore"), "node_modules\nignored_dir");
        
        await mkdir(join(tmpDir, "ignored_dir"), { recursive: true });
        await writeFile(join(tmpDir, "ignored_dir/.env"), "IGNORED=true");

        // Run scan
        // We need to mock console/prompts to avoid cluttering test output, 
        // but for now we just rely on yes: true.
        // Also note: performScan calls p.log.info etc. which will print to stdout.
        await performScan(tmpDir, { yes: true });

        // Verify quickenv.yaml
        const config = await loadConfig(join(tmpDir, "quickenv.yaml"));
        expect(config).not.toBeNull();
        // Projects are sorted or order depends on scan. 
        // We just check containment.
        const projects = config?.projects.map(p => typeof p === 'string' ? p : p.path);
        expect(projects).toContain("apps/web");
        expect(projects).toContain("apps/api");
        expect(projects).toContain(".");
        // ignored_dir should NOT be in projects
        expect(projects).not.toContain("ignored_dir");

        // Verify .env.quick
        const quickFile = Bun.file(join(tmpDir, ".quickenv/.env.quick"));
        expect(await quickFile.exists()).toBe(true);
        const quickContent = await quickFile.text();
        const sections = parseEnvQuick(quickContent);

        // Check for root var (mapped to [local])
        // .env maps to local preset.
        const localSection = sections.find(s => s.tags.includes("local") && s.tags.length === 1);
        expect(localSection).toBeDefined();
        expect(localSection?.variables["ROOT_VAR"]).toBe("root");

        // Check for web var (mapped to [apps/web:local])
        const webSection = sections.find(s => s.tags.includes("apps/web:local"));
        expect(webSection).toBeDefined();
        expect(webSection?.variables["WEB_VAR"]).toBe("123");

        // Check for api var (mapped to [apps/api:production])
        const apiSection = sections.find(s => s.tags.includes("apps/api:production"));
        expect(apiSection).toBeDefined();
        expect(apiSection?.variables["API_KEY"]).toBe("secret");
        
        // Check ignored
        // We search variables values for "IGNORED" or keys.
        let foundIgnored = false;
        for (const s of sections) {
             if (s.variables["IGNORED"]) foundIgnored = true;
        }
        expect(foundIgnored).toBe(false);
    });
});
