import type { QuickEnvSection } from "./parser";

export function resolveEnv(
  sections: QuickEnvSection[],
  preset: string,
  project?: string
): Record<string, string> {
  const result: Record<string, string> = {};

  const applyVariables = (variables: Record<string, string>) => {
    for (const [key, value] of Object.entries(variables)) {
      if (value === "") {
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

  // Layer 2: Preset
  for (const section of sections) {
    if (section.tags.includes(preset)) {
      applyVariables(section.variables);
    }
  }

  // Layer 3: Project Specific
  if (project) {
    const projectTag = `${project}:${preset}`;
    for (const section of sections) {
      if (section.tags.includes(projectTag)) {
        applyVariables(section.variables);
      }
    }
  }

  return result;
}
