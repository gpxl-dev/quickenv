import { describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "path";
import { formatEnvValue, serializeEnvFile } from "./envfile";

describe("formatEnvValue", () => {
  it("leaves simple values unquoted", () => {
    expect(formatEnvValue("hello")).toBe("hello");
    expect(formatEnvValue("postgres://localhost:5432/app")).toBe(
      "postgres://localhost:5432/app",
    );
    expect(formatEnvValue("")).toBe("");
  });

  it("single-quotes values a dotenv parser would misread", () => {
    expect(formatEnvValue("value # not a comment")).toBe("'value # not a comment'");
    expect(formatEnvValue('say "hi"')).toBe("'say \"hi\"'");
    expect(formatEnvValue(" padded ")).toBe("' padded '");
  });

  it("double-quotes values containing newlines or single quotes", () => {
    expect(formatEnvValue("line one\nline two")).toBe('"line one\\nline two"');
    expect(formatEnvValue("it's fine")).toBe("\"it's fine\"");
  });
});

describe("serializeEnvFile", () => {
  it("writes one KEY=value line per variable", () => {
    expect(serializeEnvFile({ A: "1", B: "two" })).toBe("A=1\nB=two\n");
  });

  it("round-trips tricky values through Bun's .env parser", async () => {
    const tmpDir = join(process.cwd(), "tmp_test_envfile_" + Date.now());
    await mkdir(tmpDir, { recursive: true });
    try {
      const variables = {
        MULTI: "line one\nline two",
        HASH: "value # not a comment",
        QUOTED: 'say "hi"',
        PADDED: " padded ",
        APOSTROPHE: "it's fine",
        PLAIN: "plain-value",
      };
      await writeFile(join(tmpDir, ".env"), serializeEnvFile(variables));

      const keys = JSON.stringify(Object.keys(variables));
      const proc = Bun.spawn(
        [
          "bun",
          "-e",
          `console.log(JSON.stringify(Object.fromEntries(${keys}.map(k => [k, process.env[k]]))))`,
        ],
        { cwd: tmpDir, stdout: "pipe", stderr: "pipe" },
      );
      expect(await proc.exited).toBe(0);
      const parsed = JSON.parse(await new Response(proc.stdout).text());
      expect(parsed).toEqual(variables);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
