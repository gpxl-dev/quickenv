import type { QuickEnvSection } from "./parser";

export function resolveEnv(
  sections: QuickEnvSection[],
  preset: string,
  project?: string
): Record<string, string> {
  const result: Record<string, string> = {};

  const applyVariables = (variables: Record<string, string>) => {
    for (const [key, value] of Object.entries(variables)) {
      if (value === "" || value === "UNSET") {
        delete result[key];
      } else {
        result[key] = value;
      }
    }
  };

  // Layer 1: Global (Untagged)
  for (const section of sections) {
    if (section.tags.length === 0) {
      applyVariables(section.variables);
    }
  }

  // Layer 2: Project Specific (Full match only)
  if (project) {
    for (const section of sections) {
      if (section.tags.includes(project)) {
        applyVariables(section.variables);
      }
    }
  }

  // Layer 3: Preset Specific (All projects)
  for (const section of sections) {
    if (section.tags.includes(preset)) {
      applyVariables(section.variables);
    }
  }

  // Layer 4: Wildcard combinations
  for (const section of sections) {
    for (const tag of section.tags) {
      if (project) {
        if (tag === `*:${preset}` || tag === `${project}:*`) {
          applyVariables(section.variables);
        }
      } else if (tag === `*:${preset}`) {
        applyVariables(section.variables);
      }
    }
  }

  // Layer 5: Specific combinations
  for (const section of sections) {
    for (const tag of section.tags) {
      if (project) {
        if (tag === `${project}:${preset}`) {
          applyVariables(section.variables);
        }
      } else if (tag.endsWith(`:${preset}`) && tag !== `*:${preset}`) {
        applyVariables(section.variables);
      }
    }
  }

  return result;
}
