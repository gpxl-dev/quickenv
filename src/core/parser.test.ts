import { describe, it, expect } from "bun:test";
import {
  createYamlPresetContent,
  getPresetNames,
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

  it("inherits from comma-separated parents from left to right", () => {
    const sections = parseEnvQuickYaml(`
privy:
  "*":
    PRIVY_APP_ID: privy-app
    SHARED_VALUE: privy
  shared:
    API_KEY: privy-key
  app:
    $shared: [API_KEY]
    FROM_PRIVY: yes

database:
  "*":
    DATABASE_URL: postgres://production
    SHARED_VALUE: database
  shared:
    API_KEY: database-key
  app:
    FROM_DATABASE: yes

production:
  extends: privy, database
  "*":
    SHARED_VALUE: production
`);

    expect(sections.find(section => section.tags[0] === "production")?.variables).toEqual({
      PRIVY_APP_ID: "privy-app",
      DATABASE_URL: "postgres://production",
      SHARED_VALUE: "production",
    });
    expect(sections.find(section => section.tags[0] === "app:production")?.variables).toEqual({
      API_KEY: "database-key",
      FROM_PRIVY: "yes",
      FROM_DATABASE: "yes",
    });
  });

  it("lets a later parent replace an earlier parent's shared import list", () => {
    const sections = parseEnvQuickYaml(`
first:
  shared: { ONE: one, TWO: two }
  app:
    $shared: [ONE]
second:
  shared: { ONE: one, TWO: two }
  app:
    $shared: [TWO]
combined:
  extends: first, second
`);

    expect(sections.find(section => section.tags[0] === "app:combined")?.variables).toEqual({
      TWO: "two",
    });
  });

  it("preserves inheritance from an existing preset whose name contains a comma", () => {
    const sections = parseEnvQuickYaml(`
"base,legacy":
  "*": { VALUE: inherited }
child:
  extends: base,legacy
`);

    expect(sections.find(section => section.tags[0] === "child")?.variables).toEqual({
      VALUE: "inherited",
    });
  });

  it("accepts a YAML list of parent presets", () => {
    const sections = parseEnvQuickYaml(`
first:
  "*": { FIRST: one }
second:
  "*": { SECOND: two }
combined:
  extends: [first, second]
`);

    expect(sections.find(section => section.tags[0] === "combined")?.variables).toEqual({
      FIRST: "one",
      SECOND: "two",
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

  it("rejects inheritance cycles, invalid parents, and unknown shared imports", () => {
    expect(() => parseEnvQuickYaml(`a:\n  extends: b, c\nb: {}\nc: { extends: a }`))
      .toThrow("Preset inheritance cycle: a -> c -> a.");
    expect(() => parseEnvQuickYaml(`local: { extends: [] }`))
      .toThrow("Preset 'local'.extends must name one or more presets.");
    expect(() => parseEnvQuickYaml(`local: { extends: [base, 2] }\nbase: {}`))
      .toThrow("Preset 'local'.extends must be a preset name or a list of preset names.");
    expect(() => parseEnvQuickYaml(`local:\n  extends: missing`))
      .toThrow("Preset 'local' extends unknown preset 'missing'.");
    expect(() => parseEnvQuickYaml(`local:\n  app:\n    $shared: [MISSING]`))
      .toThrow("imports unknown shared variable 'MISSING'");
  });
});

describe("preset helpers", () => {
  it("extracts unique preset names from common and project sections", () => {
    expect(
      getPresetNames([
        { tags: ["base"], variables: {} },
        { tags: ["apps/api:local"], variables: {} },
        { tags: ["local"], variables: {} },
      ]),
    ).toEqual(["base", "local"]);
  });

  it("creates an inherited YAML preset without removing comments", () => {
    const result = createYamlPresetContent(
      "# keep me\nbase:\n  '*':\n    NODE_ENV: development\n",
      "worktree-feature",
      "base",
    );

    expect(result).toContain("# keep me");
    expect(parseEnvQuickYaml(result).map((section) => section.tags)).toEqual([
      ["base"],
      ["worktree-feature"],
    ]);
    expect(result).toContain("extends: base");
  });

  it("creates a standalone preset in an empty YAML source", () => {
    const result = createYamlPresetContent("", "local");
    expect(parseEnvQuickYaml(result)).toEqual([
      { tags: ["local"], variables: {} },
    ]);
  });

  it("refuses to overwrite an existing preset", () => {
    expect(() => createYamlPresetContent("local: {}\n", "local")).toThrow(
      "Preset 'local' already exists",
    );
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
