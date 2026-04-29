import picomatch from "picomatch";
import type { QuickEnvSection } from "./parser";

/**
 * Check if a string contains glob characters (*, ?, [...]).
 * A bare "*" alone is NOT treated as a glob — it's the existing wildcard syntax.
 */
function isGlob(segment: string): boolean {
  if (segment === "*") return false;
  return picomatch.isMatch !== undefined && /[*?[\]]/.test(segment);
}

/**
 * Check if a tag's project segment matches the given project name.
 * Supports exact match and glob patterns.
 */
function matchesProject(tagProject: string, project: string): boolean {
  if (tagProject === project) return true;
  if (isGlob(tagProject)) {
    return picomatch.isMatch(project, tagProject);
  }
  return false;
}

/**
 * Parse a tag into its project and preset segments.
 * Returns { project, preset } where either may be undefined.
 * e.g. "apps/web:local" → { project: "apps/web", preset: "local" }
 *      "local"          → { project: undefined, preset: undefined } (simple tag)
 *      "apps/web-*:local" → { project: "apps/web-*", preset: "local" }
 */
function parseTag(tag: string): { project?: string; preset?: string } {
  const colonIdx = tag.lastIndexOf(":");
  if (colonIdx === -1) return {};
  return {
    project: tag.substring(0, colonIdx),
    preset: tag.substring(colonIdx + 1),
  };
}

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

  // Layer 2: Project Specific (exact or glob match, no preset component)
  if (project) {
    for (const section of sections) {
      for (const tag of section.tags) {
        // Skip tags with a colon (those are project:preset combos handled later)
        if (tag.includes(":")) continue;
        if (matchesProject(tag, project)) {
          applyVariables(section.variables);
        }
      }
    }
  }

  // Layer 3: Preset Specific (All projects)
  for (const section of sections) {
    if (section.tags.includes(preset)) {
      applyVariables(section.variables);
    }
  }

  // Layer 4: Wildcard combinations (*:preset, project:*, glob:*)
  for (const section of sections) {
    for (const tag of section.tags) {
      const parsed = parseTag(tag);
      if (!parsed.project || !parsed.preset) continue;

      if (project) {
        // *:preset — all projects with this preset
        if (parsed.project === "*" && parsed.preset === preset) {
          applyVariables(section.variables);
        }
        // project:* or glob:* — this project, any preset
        else if (parsed.preset === "*" && matchesProject(parsed.project, project)) {
          applyVariables(section.variables);
        }
      } else if (parsed.project === "*" && parsed.preset === preset) {
        applyVariables(section.variables);
      }
    }
  }

  // Layer 5: Specific combinations (project:preset, glob:preset)
  for (const section of sections) {
    for (const tag of section.tags) {
      const parsed = parseTag(tag);
      if (!parsed.project || !parsed.preset) continue;
      if (parsed.project === "*" || parsed.preset === "*") continue;

      if (project) {
        if (parsed.preset === preset && matchesProject(parsed.project, project)) {
          applyVariables(section.variables);
        }
      } else if (parsed.preset === preset) {
        // No project filter — include all project:preset matches
        applyVariables(section.variables);
      }
    }
  }

  return result;
}
