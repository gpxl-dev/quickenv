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
});
