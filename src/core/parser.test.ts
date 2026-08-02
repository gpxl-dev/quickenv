import { describe, it, expect } from "bun:test";
import {
  parseEnvQuick,
  parseEnvQuickYaml,
  parseEnvQuickYamlSources,
  updateEnvQuickContent,
} from "./parser";

describe("parseEnvQuick", () => {
  it("parses global variables", () => {
    const input = `
VAR1=value1
VAR2=value2
`;
    const result = parseEnvQuick(input);
    expect(result).toEqual([
      {
        tags: [],
        variables: {
          VAR1: "value1",
          VAR2: "value2",
        },
      },
    ]);
  });

  it("parses tagged sections", () => {
    const input = `
[local]
VAR1=local_value

[production, staging]
VAR2=prod_value
`;
    const result = parseEnvQuick(input);
    expect(result).toEqual([
      {
        tags: ["local"],
        variables: { VAR1: "local_value" },
      },
      {
        tags: ["production", "staging"],
        variables: { VAR2: "prod_value" },
      },
    ]);
  });

  it("parses project:preset tags", () => {
    const input = `
[api-server:local]
DB_URL=postgres://local
`;
    const result = parseEnvQuick(input);
    expect(result).toEqual([
      {
        tags: ["api-server:local"],
        variables: { DB_URL: "postgres://local" },
      },
    ]);
  });

  it("handles mixed global and tagged sections with comments", () => {
    const input = `
# Global
GLOBAL=true

[local]
# Local specific
DEBUG=true
`;
    const result = parseEnvQuick(input);
    expect(result).toEqual([
      {
        tags: [],
        variables: { GLOBAL: "true" },
      },
      {
        tags: ["local"],
        variables: { DEBUG: "true" },
      },
    ]);
  });

  it("handles empty values (unset)", () => {
    const input = `
[production]
DEBUG=
`;
    const result = parseEnvQuick(input);
    expect(result).toEqual([
      {
        tags: ["production"],
        variables: { DEBUG: "" },
      },
    ]);
  });

  it("ignores whitespace", () => {
      const input = `
      
      VAR=val
      
      [tag]
      VAR2=val2
      `;
      const result = parseEnvQuick(input);
      expect(result).toEqual([
          { tags: [], variables: { VAR: "val" } },
          { tags: ["tag"], variables: { VAR2: "val2" } }
      ])
  })
});

describe("parseEnvQuickYaml", () => {
  it("resolves preset inheritance, shared imports, overrides, and scalar strings", () => {
    const sections = parseEnvQuickYaml(`
base:
  "*":
    COMMON: foo
    COUNT: 2
    ENABLED: true
    NOTHING: null
  shared:
    DATABASE_URL: postgres://base
    HOSTNAME: localhost
  apps/api:
    $shared: [DATABASE_URL, HOSTNAME]
    PORT: 3000

local:
  extends: base
  shared:
    DATABASE_URL: postgres://local

production:
  extends: local
  apps/api:
    HOSTNAME: api.example.com
`);

    expect(sections.find(section => section.tags[0] === "base")?.variables).toEqual({
      COMMON: "foo",
      COUNT: "2",
      ENABLED: "true",
      NOTHING: "null",
    });
    expect(sections.find(section => section.tags[0] === "apps/api:local")?.variables).toEqual({
      DATABASE_URL: "postgres://local",
      HOSTNAME: "localhost",
      PORT: "3000",
    });
    expect(sections.find(section => section.tags[0] === "apps/api:production")?.variables).toEqual({
      DATABASE_URL: "postgres://local",
      HOSTNAME: "api.example.com",
      PORT: "3000",
    });
  });

  it("accepts all as an alias for the common project scope", () => {
    const sections = parseEnvQuickYaml(`
local:
  all:
    COMMON: value
`);

    expect(sections).toEqual([{ tags: ["local"], variables: { COMMON: "value" } }]);
  });

  it("keeps every top-level preset selectable", () => {
    const sections = parseEnvQuickYaml(`
base:
empty-child:
  extends: base
`);

    expect(sections.map(section => section.tags)).toEqual([["base"], ["empty-child"]]);
  });

  it("lets a child replace an inherited shared import list", () => {
    const sections = parseEnvQuickYaml(`
base:
  shared:
    ONE: one
    TWO: two
  app:
    $shared: [ONE, TWO]
child:
  extends: base
  app:
    $shared: [TWO]
`);

    expect(sections.find(section => section.tags[0] === "app:child")?.variables).toEqual({ TWO: "two" });
  });

  it("composes inheritance and shared overrides across ordered YAML sources", () => {
    const sections = parseEnvQuickYamlSources([
      `base:\n  shared:\n    URL: base\n  app:\n    $shared: [URL]\nlocal:\n  extends: base\n`,
      `local:\n  shared:\n    URL: override\n`,
    ]);

    expect(sections.find(section => section.tags[0] === "app:local")?.variables).toEqual({
      URL: "override",
    });
  });

  it("rejects inheritance cycles and unknown shared imports", () => {
    expect(() => parseEnvQuickYaml(`a: { extends: b }\nb: { extends: a }`))
      .toThrow("Preset inheritance cycle: a -> b -> a.");
    expect(() => parseEnvQuickYaml(`local:\n  app:\n    $shared: [MISSING]`))
      .toThrow("imports unknown shared variable 'MISSING'");
  });
});

describe("updateEnvQuickContent", () => {
  it("updates YAML structurally and uses an existing all alias", () => {
    const result = updateEnvQuickContent(`# keep me\nlocal:\n  all:\n    EXISTING: old\n`, ".env.quick.yaml", [{
      preset: "local",
      variables: { EXISTING: "new", COUNT: "123" },
    }]);

    expect(result).toContain("# keep me");
    expect(parseEnvQuickYaml(result)).toEqual([{
      tags: ["local"],
      variables: { EXISTING: "new", COUNT: "123" },
    }]);
  });

  it("updates a selectable null preset", () => {
    const result = updateEnvQuickContent("local:\n", ".env.quick.yaml", [{
      preset: "local",
      variables: { ADDED: "value" },
    }]);

    expect(parseEnvQuickYaml(result)).toEqual([{
      tags: ["local"],
      variables: { ADDED: "value" },
    }]);
  });

  it("does not freeze inherited or shared values during only-if-missing updates", () => {
    const content = `
base:
  "*":
    COMMON: inherited
  shared:
    URL: shared
  app:
    $shared: [URL]
local:
  extends: base
`;
    const result = updateEnvQuickContent(content, ".env.quick.yaml", [{
      preset: "local",
      project: "app",
      variables: { COMMON: "generated", URL: "generated", NEW: "added" },
    }], { onlyIfMissing: true });

    const local = parseEnvQuickYaml(result);
    expect(local.find(section => section.tags[0] === "local")?.variables.COMMON).toBe("inherited");
    expect(local.find(section => section.tags[0] === "app:local")?.variables).toEqual({
      URL: "shared",
      NEW: "added",
    });
  });

  it("uses merged effective sections when updating a YAML overlay", () => {
    const base = `base:\n  shared:\n    URL: base\n  app:\n    $shared: [URL]\n`;
    const overlay = `local:\n  extends: base\n`;
    const mergedEffectiveSections = parseEnvQuickYamlSources([base, overlay]);
    const result = updateEnvQuickContent(overlay, ".env.quick.yaml", [{
      preset: "local",
      project: "app",
      variables: { URL: "generated" },
    }], { onlyIfMissing: true, mergedEffectiveSections });

    expect(result).toBe(overlay);
  });

  it("does not rewrite a source when only-if-missing finds no updates", () => {
    const content = "# keep formatting\nlocal: { all: { EXISTING: old } }\n";
    const result = updateEnvQuickContent(content, ".env.quick.yaml", [{
      preset: "local",
      variables: { EXISTING: "new" },
    }], { onlyIfMissing: true });

    expect(result).toBe(content);
  });

  it("retains legacy update support", () => {
    const result = updateEnvQuickContent("[local]\nOLD=value\n", ".env.quick", [{
      preset: "local",
      variables: { NEW: "value" },
    }]);

    expect(parseEnvQuick(result)[0]?.variables).toEqual({ OLD: "value", NEW: "value" });
  });
});
