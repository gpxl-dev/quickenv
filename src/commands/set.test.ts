import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { mkdir, rm, writeFile } from "node:fs/promises";

const INDEX_PATH = join(import.meta.dir, "../../index.ts");

describe("set command", () => {
    const tmpDir = join(process.cwd(), "tmp_test_set_" + Date.now());

    beforeAll(async () => {
        await mkdir(join(tmpDir, "apps/svc"), { recursive: true });
        await mkdir(join(tmpDir, ".quickenv"), { recursive: true });
        await writeFile(
            join(tmpDir, "quickenv.yaml"),
            `projects:\n  - apps/svc\npresets:\n  production:\n    target: .env.production\n`,
        );
        await writeFile(
            join(tmpDir, ".quickenv/.env.quick.yaml"),
            `production:\n  "*":\n    BASE_VAR: base\n`,
        );
        await writeFile(
            join(tmpDir, ".quickenv/.quickenv.state"),
            JSON.stringify({ activePreset: "production" }),
        );
    });

    afterAll(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it("writes ephemeral updates to the active preset's target file", async () => {
        const proc = Bun.spawn(["bun", INDEX_PATH, "set", "FOO", "bar"], {
            cwd: tmpDir,
            stdout: "pipe",
            stderr: "pipe",
            stdin: "ignore",
        });
        expect(await proc.exited).toBe(0);

        const targetFile = Bun.file(join(tmpDir, "apps/svc/.env.production"));
        expect(await targetFile.exists()).toBe(true);
        const content = await targetFile.text();
        expect(content).toContain("BASE_VAR=base");
        expect(content).toContain("FOO=bar");

        // Must not fall back to the default .env target
        expect(await Bun.file(join(tmpDir, "apps/svc/.env")).exists()).toBe(false);
    });
});
