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

  // Glob pattern tests

  it("supports glob patterns in project tags", () => {
    const input = `
[apps/web-*]
SHARED=true
`;
    const sections = parseEnvQuick(input);

    const resultMatch = resolveEnv(sections, "local", "apps/web-admin");
    expect(resultMatch.SHARED).toBe("true");

    const resultMatch2 = resolveEnv(sections, "local", "apps/web-client");
    expect(resultMatch2.SHARED).toBe("true");

    const resultNoMatch = resolveEnv(sections, "local", "apps/api");
    expect(resultNoMatch.SHARED).toBeUndefined();
  });

  it("supports glob patterns combined with presets (glob:preset)", () => {
    const input = `
[apps/web-*:local]
DEBUG=true
`;
    const sections = parseEnvQuick(input);

    const resultMatch = resolveEnv(sections, "local", "apps/web-admin");
    expect(resultMatch.DEBUG).toBe("true");

    const resultWrongPreset = resolveEnv(sections, "production", "apps/web-admin");
    expect(resultWrongPreset.DEBUG).toBeUndefined();

    const resultWrongProject = resolveEnv(sections, "local", "apps/api");
    expect(resultWrongProject.DEBUG).toBeUndefined();
  });

  it("supports glob patterns with wildcard preset (glob:*)", () => {
    const input = `
[apps/web-*:*]
ALWAYS=true
`;
    const sections = parseEnvQuick(input);

    const result = resolveEnv(sections, "production", "apps/web-admin");
    expect(result.ALWAYS).toBe("true");

    const resultNoMatch = resolveEnv(sections, "production", "apps/api");
    expect(resultNoMatch.ALWAYS).toBeUndefined();
  });

  it("supports mixed exact and glob tags in the same section", () => {
    const input = `
[apps/cybercorps-web, apps/lexchex-web, apps/web-*]
NEXT_PUBLIC_SOMEVAR=someval
`;
    const sections = parseEnvQuick(input);

    // Exact matches
    expect(resolveEnv(sections, "local", "apps/cybercorps-web").NEXT_PUBLIC_SOMEVAR).toBe("someval");
    expect(resolveEnv(sections, "local", "apps/lexchex-web").NEXT_PUBLIC_SOMEVAR).toBe("someval");

    // Glob match
    expect(resolveEnv(sections, "local", "apps/web-admin").NEXT_PUBLIC_SOMEVAR).toBe("someval");

    // No match
    expect(resolveEnv(sections, "local", "apps/api").NEXT_PUBLIC_SOMEVAR).toBeUndefined();
  });

  it("glob project:preset has correct precedence (Layer 5)", () => {
    const input = `
[local]
VAR=from-preset

[apps/web-*:local]
VAR=from-glob-preset
`;
    const sections = parseEnvQuick(input);
    const result = resolveEnv(sections, "local", "apps/web-admin");
    expect(result.VAR).toBe("from-glob-preset");
  });

  it("exact project:preset beats glob project:preset at same layer", () => {
    const input = `
[apps/web-*:local]
VAR=from-glob

[apps/web-admin:local]
VAR=from-exact
`;
    const sections = parseEnvQuick(input);
    const result = resolveEnv(sections, "local", "apps/web-admin");
    expect(result.VAR).toBe("from-exact");
  });

  it("supports ** glob for deep matching", () => {
    const input = `
[packages/**/utils]
UTIL=true
`;
    const sections = parseEnvQuick(input);
    expect(resolveEnv(sections, "local", "packages/shared/utils").UTIL).toBe("true");
    expect(resolveEnv(sections, "local", "packages/core/lib/utils").UTIL).toBe("true");
    expect(resolveEnv(sections, "local", "packages/utils").UTIL).toBe("true");
  });
});
