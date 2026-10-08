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

export interface TaggedSection<TVariables> {
  tags: string[];
  variables: TVariables;
}

/**
 * Visit sections in precedence order for a preset/project resolution.
 * Layers, lowest to highest precedence:
 *   1. untagged (global)
 *   2. project tags without a preset component (exact or glob)
 *   3. bare preset tags (all projects)
 *   4. wildcard combinations (*:preset, project:*, glob:*)
 *   5. specific combinations (project:preset, glob:preset)
 * Both resolveEnv and the annotated resolver in `list` share this traversal
 * so their matching semantics cannot drift apart.
 */
export function forEachResolvedSection<TVariables>(
  sections: TaggedSection<TVariables>[],
  preset: string,
  project: string | undefined,
  apply: (section: TaggedSection<TVariables>) => void,
): void {
  // Layer 1: Global (Untagged)
  for (const section of sections) {
    if (section.tags.length === 0) {
      apply(section);
    }
  }

  // Layer 2: Project Specific (exact or glob match, no preset component)
  if (project) {
    for (const section of sections) {
      for (const tag of section.tags) {
        // Skip tags with a colon (those are project:preset combos handled later)
        if (tag.includes(":")) continue;
        if (matchesProject(tag, project)) {
          apply(section);
        }
      }
    }
  }

  // Layer 3: Preset Specific (All projects)
  for (const section of sections) {
    if (section.tags.includes(preset)) {
      apply(section);
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
          apply(section);
        }
        // project:* or glob:* — this project, any preset
        else if (parsed.preset === "*" && matchesProject(parsed.project, project)) {
          apply(section);
        }
      } else if (parsed.project === "*" && parsed.preset === preset) {
        apply(section);
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
          apply(section);
        }
      } else if (parsed.preset === preset) {
        // No project filter — include all project:preset matches
        apply(section);
      }
    }
  }
}

export function resolveEnv(
  sections: QuickEnvSection[],
  preset: string,
  project?: string
): Record<string, string> {
  const result: Record<string, string> = {};

  forEachResolvedSection(sections, preset, project, (section) => {
    for (const [key, value] of Object.entries(section.variables)) {
      if (value === "" || value === "UNSET") {
        delete result[key];
      } else {
        result[key] = value;
      }
    }
  });

  return result;
}
