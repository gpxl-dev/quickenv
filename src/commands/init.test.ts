import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { mkdir, rm, writeFile } from "node:fs/promises";

const INDEX_PATH = join(import.meta.dir, "../../index.ts");

describe("init command", () => {
    const tmpDir = join(process.cwd(), "tmp_test_init_" + Date.now());

    beforeAll(async () => {
        await mkdir(join(tmpDir, "apps/web"), { recursive: true });
        await mkdir(join(tmpDir, "apps/api"), { recursive: true });
        await writeFile(
            join(tmpDir, "package.json"),
            JSON.stringify({ name: "demo", workspaces: ["apps/*"] }),
        );
        await writeFile(join(tmpDir, "apps/web/package.json"), JSON.stringify({ name: "web" }));
        await writeFile(join(tmpDir, "apps/api/package.json"), JSON.stringify({ name: "api" }));
    });

    afterAll(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it("detects projects from package.json workspaces", async () => {
        const proc = Bun.spawn(["bun", INDEX_PATH, "init"], {
            cwd: tmpDir,
            stdout: "pipe",
            stderr: "pipe",
            stdin: "ignore",
        });
        expect(await proc.exited).toBe(0);

        const config = await Bun.file(join(tmpDir, "quickenv.yaml")).text();
        expect(config).toContain("- apps/api");
        expect(config).toContain("- apps/web");
    });
});
