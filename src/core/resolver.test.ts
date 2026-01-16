import { describe, it, expect } from "bun:test";
import { resolveEnv } from "./resolver";
import { parseEnvQuick } from "./parser";

describe("resolveEnv", () => {
  it("resolves global variables", () => {
    const input = `
GLOBAL=1
`;
    const sections = parseEnvQuick(input);
    const result = resolveEnv(sections, "local", "web");
    expect(result).toEqual({ GLOBAL: "1" });
  });

  it("resolves preset variables", () => {
    const input = `
[local]
VAR=local
`;
    const sections = parseEnvQuick(input);
    const result = resolveEnv(sections, "local", "web");
    expect(result).toEqual({ VAR: "local" });
  });

  it("resolves project:preset variables", () => {
    const input = `
[web:local]
VAR=web-local
`;
    const sections = parseEnvQuick(input);
    const result = resolveEnv(sections, "local", "web");
    expect(result).toEqual({ VAR: "web-local" });
  });

  it("respects precedence: project:preset > preset > global", () => {
    const input = `
VAR=global
[local]
VAR=preset
[web:local]
VAR=project-preset
`;
    const sections = parseEnvQuick(input);
    const result = resolveEnv(sections, "local", "web");
    expect(result).toEqual({ VAR: "project-preset" });
  });

  it("respects precedence: preset > global", () => {
    const input = `
VAR=global
[local]
VAR=preset
`;
    const sections = parseEnvQuick(input);
    const result = resolveEnv(sections, "local", "web");
    expect(result).toEqual({ VAR: "preset" });
  });

  it("respects file order for equal specificity", () => {
    const input = `
[local]
VAR=first
[local]
VAR=second
`;
    const sections = parseEnvQuick(input);
    const result = resolveEnv(sections, "local", "web");
    expect(result).toEqual({ VAR: "second" });
  });

  it("higher specificity earlier in file beats lower specificity later", () => {
    const input = `
[web:local]
VAR=specific
[local]
VAR=general
`;
    const sections = parseEnvQuick(input);
    const result = resolveEnv(sections, "local", "web");
    expect(result).toEqual({ VAR: "specific" });
  });

  it("unset value removes the variable", () => {
    const input = `
VAR=exist
[local]
VAR=
`;
    const sections = parseEnvQuick(input);
    const result = resolveEnv(sections, "local", "web");
    expect(result).toEqual({});
  });
  
  it("ignores irrelevant tags", () => {
      const input = `
      [production]
      VAR=prod
      [api:local]
      VAR=api
      `;
      const sections = parseEnvQuick(input);
      const result = resolveEnv(sections, "local", "web");
      expect(result).toEqual({});
  });

  it("resolves all project:preset variables when project is omitted", () => {
    const input = `
[web:local]
VAR1=web
[api:local]
VAR2=api
`;
    const sections = parseEnvQuick(input);
    const result = resolveEnv(sections, "local");
    expect(result).toEqual({ VAR1: "web", VAR2: "api" });
  });

  it("resolves project variables (without preset)", () => {
    const input = `
VAR_GLOBAL=global
[web]
VAR_PROJECT=project-only
`;
    const sections = parseEnvQuick(input);
    const result = resolveEnv(sections, "local", "web");
    expect(result).toEqual({ VAR_GLOBAL: "global", VAR_PROJECT: "project-only" });
  });

  it("prioritizes project variables over preset variables", () => {
    const input = `
[local]
VAR=preset
[web]
VAR=project
`;
    const sections = parseEnvQuick(input);
    const result = resolveEnv(sections, "local", "web");
    expect(result).toEqual({ VAR: "project" });
  });
});
