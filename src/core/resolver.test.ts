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

  it("prioritizes preset variables over project variables", () => {
    const input = `
[local]
VAR=preset
[web]
VAR=project
`;
    const sections = parseEnvQuick(input);
    const result = resolveEnv(sections, "local", "web");
    expect(result).toEqual({ VAR: "preset" });
  });

  it("supports wildcards in project tags", () => {
    const input = `
SOME_TOP_LEVEL_VAR=test

[apps/lexchex-oracle:*]
OTHER_VAR=false

[apps/lexchex-oracle:production]
OTHER_VAR=true
`;
    const sections = parseEnvQuick(input);
    
    // Test with production preset
    const resultProd = resolveEnv(sections, "production", "apps/lexchex-oracle");
    expect(resultProd.SOME_TOP_LEVEL_VAR).toBe("test");
    expect(resultProd.OTHER_VAR).toBe("true");

    // Test with staging preset (should fallback to wildcard)
    const resultStaging = resolveEnv(sections, "staging", "apps/lexchex-oracle");
    expect(resultStaging.SOME_TOP_LEVEL_VAR).toBe("test");
    expect(resultStaging.OTHER_VAR).toBe("false");
  });

  it("supports wildcards in preset tags", () => {
    const input = `
[*:local]
DEBUG=true

[web:local]
DEBUG=false
`;
    const sections = parseEnvQuick(input);

    // Test with web project (specific beats wildcard)
    const resultWeb = resolveEnv(sections, "local", "web");
    expect(resultWeb.DEBUG).toBe("false");

    // Test with other project (wildcard matches)
    const resultApi = resolveEnv(sections, "local", "api");
    expect(resultApi.DEBUG).toBe("true");
  });

  it("prioritizes project wildcard tags over preset tags", () => {
    const input = `
[production]
VAR=preset-important

[web:*]
VAR=project-default
`;
    const sections = parseEnvQuick(input);
    const result = resolveEnv(sections, "production", "web");
    
    expect(result.VAR).toBe("project-default");
  });

  it("supports UNSET value to remove a variable", () => {
    const input = `
VAR=exist
[local]
VAR=UNSET
`;
    const sections = parseEnvQuick(input);
    const result = resolveEnv(sections, "local", "web");
    expect(result).toEqual({});
  });
});
