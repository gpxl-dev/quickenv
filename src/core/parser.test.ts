import { describe, it, expect } from "bun:test";
import { parseEnvQuick } from "./parser";

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
