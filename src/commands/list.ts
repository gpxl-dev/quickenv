import { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadConfig, loadState, resolveEnvQuickPath } from "../core/config";
import { parseEnvQuick } from "../core/parser";
import { maskValue } from "../core/masking";
import { basename } from "path";

const FILE_COLORS: Array<(text: string | number) => string> = [
  pc.cyan,
  pc.magenta,
  pc.yellow,
  pc.green,
  pc.blue,
  pc.red,
];

interface AnnotatedVariable {
  value: string;
  sourceIndex: number;
  setBy: string;
}

interface UnsetVariable {
  key: string;
  /** The section that originally set the variable before it was unset */
  previousSetBy: string;
  /** The section that unset the variable */
  unsetBy: string;
  sourceIndex: number;
}

interface ResolveResult {
  variables: Record<string, AnnotatedVariable>;
  unsets: UnsetVariable[];
}

interface AnnotatedSection {
  tags: string[];
  variables: Record<string, AnnotatedVariable>;
}

function parseAndAnnotate(content: string, sourceIndex: number): AnnotatedSection[] {
  const sections = parseEnvQuick(content);
  return sections.map(s => ({
    tags: s.tags,
    variables: Object.fromEntries(
      Object.entries(s.variables).map(([k, v]) => [k, { value: v, sourceIndex, setBy: "" }])
    ),
  }));
}

function mergeAnnotatedSections(
  fileContents: Array<{ content: string; sourceIndex: number }>
): AnnotatedSection[] {
  const sectionsMap = new Map<string, Map<string, AnnotatedVariable>>();

  for (const { content, sourceIndex } of fileContents) {
    const sections = parseAndAnnotate(content, sourceIndex);
    for (const section of sections) {
      const tagKey = section.tags.join(",");
      if (!sectionsMap.has(tagKey)) {
        sectionsMap.set(tagKey, new Map());
      }
      const varMap = sectionsMap.get(tagKey)!;
      for (const [key, annotated] of Object.entries(section.variables)) {
        varMap.set(key, annotated);
      }
    }
  }

  const merged: AnnotatedSection[] = [];
  for (const [tagKey, varMap] of sectionsMap) {
    const tags = tagKey ? tagKey.split(",") : [];
    const variables: Record<string, AnnotatedVariable> = {};
    for (const [key, annotated] of varMap) {
      variables[key] = annotated;
    }
    merged.push({ tags, variables });
  }
  return merged;
}

function formatSetBy(tags: string[]): string {
  if (tags.length === 0) return "global";
  return `[${tags.join(", ")}]`;
}

function resolveEnvWithSources(
  sections: AnnotatedSection[],
  preset: string,
  project?: string
): ResolveResult {
  const result: Record<string, AnnotatedVariable> = {};
  const unsetMap = new Map<string, UnsetVariable>();

  const applyVariables = (variables: Record<string, AnnotatedVariable>, setBy: string) => {
    for (const [key, annotated] of Object.entries(variables)) {
      if (annotated.value === "" || annotated.value === "UNSET") {
        const previous = result[key];
        if (previous) {
          unsetMap.set(key, {
            key,
            previousSetBy: previous.setBy,
            unsetBy: setBy,
            sourceIndex: annotated.sourceIndex,
          });
        }
        delete result[key];
      } else {
        // If this variable was previously tracked as unset, remove it from unsets
        unsetMap.delete(key);
        result[key] = { ...annotated, setBy };
      }
    }
  };

  // Layer 1: Global (Untagged)
  for (const section of sections) {
    if (section.tags.length === 0) {
      applyVariables(section.variables, "global");
    }
  }

  // Layer 2: Project Specific (Full match only)
  if (project) {
    for (const section of sections) {
      if (section.tags.includes(project)) {
        applyVariables(section.variables, formatSetBy(section.tags));
      }
    }
  }

  // Layer 3: Preset Specific (All projects)
  for (const section of sections) {
    if (section.tags.includes(preset)) {
      applyVariables(section.variables, formatSetBy(section.tags));
    }
  }

  // Layer 4: Wildcard combinations
  for (const section of sections) {
    for (const tag of section.tags) {
      if (project) {
        if (tag === `*:${preset}` || tag === `${project}:*`) {
          applyVariables(section.variables, formatSetBy(section.tags));
        }
      } else if (tag === `*:${preset}`) {
        applyVariables(section.variables, formatSetBy(section.tags));
      }
    }
  }

  // Layer 5: Specific combinations
  for (const section of sections) {
    for (const tag of section.tags) {
      if (project) {
        if (tag === `${project}:${preset}`) {
          applyVariables(section.variables, formatSetBy(section.tags));
        }
      } else if (tag.endsWith(`:${preset}`) && tag !== `*:${preset}`) {
        applyVariables(section.variables, formatSetBy(section.tags));
      }
    }
  }

  return { variables: result, unsets: Array.from(unsetMap.values()) };
}

function getProjectPath(proj: string | { path: string; target?: string }): string {
  return typeof proj === "string" ? proj : proj.path;
}

function resolveAppArg(appArg: string, projectPaths: string[]): string | undefined {
  // Exact match
  if (projectPaths.includes(appArg)) return appArg;

  // Match by basename (e.g. "pump-web" matches "apps/pump-web")
  const byBasename = projectPaths.find(p => basename(p) === appArg);
  if (byBasename) return byBasename;

  // Partial path match (e.g. "pump" matches "apps/pump-web")
  const byPartial = projectPaths.find(p => p.includes(appArg));
  if (byPartial) return byPartial;

  return undefined;
}

function truncateValue(value: string, maxWidth: number): string {
  if (value.length <= maxWidth) return value;
  return value.substring(0, maxWidth - 1) + "…";
}

function printVerbose(
  entries: Array<{ key: string; maskedValue: string; setBy: string }>,
  colorFn?: (text: string | number) => string
) {
  const termWidth = process.stdout.columns || 120;
  const nameWidth = Math.max(...entries.map(e => e.key.length));
  const setByWidth = Math.max(...entries.map(e => e.setBy.length));
  // Reserve space for name + gaps (4 spaces) + setBy, rest goes to value
  const maxValueWidth = Math.max(20, termWidth - nameWidth - setByWidth - 6);
  const valueWidth = Math.min(
    maxValueWidth,
    Math.max(...entries.map(e => e.maskedValue.length))
  );

  for (const { key, maskedValue, setBy } of entries) {
    const name = key.padEnd(nameWidth);
    const value = truncateValue(maskedValue, valueWidth).padEnd(valueWidth);
    const setByLabel = pc.dim(setBy);

    if (colorFn) {
      console.log(`${colorFn(name)}  ${colorFn(value)}  ${setByLabel}`);
    } else {
      console.log(`${name}  ${value}  ${setByLabel}`);
    }
  }
}

export const listCommand = new Command("list")
  .alias("show")
  .description("Displays the effective environment variables for the current active preset")
  .argument("[app]", "Project/app to list variables for (path or name)")
  .option("-s, --suffix <preset>", "View values for a specific preset without switching")
  .option("--no-verbose", "Hide which section each variable is set by")
  .action(async (appArg: string | undefined, options) => {
    const config = await loadConfig();
    const state = await loadState();

    const preset = options.suffix || state.activePreset;
    const verbose = options.verbose !== false;

    if (!preset) {
      console.error("No active preset found. Use 'quickenv switch' or provide --suffix.");
      process.exit(1);
    }

    const envResult = await resolveEnvQuickPath();
    const envFile = Bun.file(envResult.path);
    if (!(await envFile.exists())) {
      if (envResult.isCustom) {
        console.error(`${envResult.path} not found (custom path from .quickenv.state). Run 'quickenv init'.`);
      } else if (envResult.fallbackFrom) {
        console.error(`${envResult.fallbackFrom} not found (custom path from .quickenv.state), and default location ${envResult.path} not found. Run 'quickenv init'.`);
      } else {
        console.error(`${envResult.path} not found. Run 'quickenv init'.`);
      }
      process.exit(1);
    }

    // Resolve project selection
    const projects = config?.projects || [];
    const projectPaths = projects.map(getProjectPath);
    let selectedProject: string | undefined;

    if (appArg) {
      const match = resolveAppArg(appArg, projectPaths);
      if (!match) {
        console.error(`Project '${appArg}' not found in quickenv.yaml.`);
        console.error(`Available projects: ${projectPaths.join(", ")}`);
        process.exit(1);
      }
      selectedProject = match;
    } else if (projects.length > 0) {
      const selected = await p.select({
        message: "Select a project to list variables for:",
        options: [
          { value: "__all__", label: pc.dim("All (no project filter)") },
          ...projectPaths.map(path => ({ value: path, label: path })),
        ],
      });

      if (p.isCancel(selected)) {
        process.exit(0);
      }

      selectedProject = selected === "__all__" ? undefined : (selected as string);
    }

    const multiFile = envResult.paths.length > 1;
    const projectLabel = selectedProject ? ` (${selectedProject})` : "";

    // Load and annotate all source files
    const fileContents: Array<{ content: string; sourceIndex: number }> = [];
    for (let i = 0; i < envResult.paths.length; i++) {
      const content = await Bun.file(envResult.paths[i]!).text();
      fileContents.push({ content, sourceIndex: i });
    }

    const annotatedSections = mergeAnnotatedSections(fileContents);
    const { variables, unsets } = resolveEnvWithSources(annotatedSections, preset, selectedProject);

    if (Object.keys(variables).length === 0 && unsets.length === 0) {
      console.log(`No variables defined for preset '${preset}'${projectLabel}.`);
      return;
    }

    console.log(`\nEnvironment variables for preset '${preset}'${projectLabel}:\n`);

    // Print file legend when multi-file
    if (multiFile) {
      console.log(pc.dim("Sources:"));
      for (let i = 0; i < envResult.paths.length; i++) {
        const colorFn = FILE_COLORS[i % FILE_COLORS.length]!;
        console.log(`  ${colorFn("●")} ${envResult.paths[i]}`);
      }
      console.log();
    }

    if (verbose) {
      const entries = Object.entries(variables).map(([key, annotated]) => ({
        key,
        maskedValue: maskValue(key, annotated.value, config),
        setBy: annotated.setBy,
        sourceIndex: annotated.sourceIndex,
      }));

      const unsetEntries = unsets.map(u => ({
        key: u.key,
        maskedValue: "UNSET",
        setBy: `unset by ${u.unsetBy}, was ${u.previousSetBy}`,
        sourceIndex: u.sourceIndex,
      }));

      const allEntries = [...entries, ...unsetEntries];

      if (multiFile) {
        const termWidth = process.stdout.columns || 120;
        const nameWidth = Math.max(...allEntries.map(e => e.key.length));
        const setByWidth = Math.max(...allEntries.map(e => e.setBy.length));
        const maxValueWidth = Math.max(20, termWidth - nameWidth - setByWidth - 6);
        const valueWidth = Math.min(
          maxValueWidth,
          Math.max(...allEntries.map(e => e.maskedValue.length))
        );

        for (const { key, maskedValue, setBy, sourceIndex } of entries) {
          const colorFn = FILE_COLORS[sourceIndex % FILE_COLORS.length]!;
          const name = key.padEnd(nameWidth);
          const value = truncateValue(maskedValue, valueWidth).padEnd(valueWidth);
          console.log(`${colorFn(name)}  ${colorFn(value)}  ${pc.dim(setBy)}`);
        }

        if (unsetEntries.length > 0) {
          console.log();
          for (const { key, maskedValue, setBy, sourceIndex } of unsetEntries) {
            const colorFn = FILE_COLORS[sourceIndex % FILE_COLORS.length]!;
            const name = colorFn(pc.strikethrough(key)).padEnd(nameWidth + (colorFn(pc.strikethrough(key)).length - key.length));
            const value = pc.dim(maskedValue).padEnd(valueWidth + (pc.dim(maskedValue).length - maskedValue.length));
            console.log(`${name}  ${value}  ${pc.dim(setBy)}`);
          }
        }
      } else {
        printVerbose(entries);

        if (unsetEntries.length > 0) {
          console.log();
          printVerbose(unsetEntries, (text) => pc.strikethrough(pc.dim(String(text))));
        }
      }
    } else {
      // Non-verbose output
      for (const [key, annotated] of Object.entries(variables)) {
        const masked = maskValue(key, annotated.value, config);
        if (multiFile) {
          const colorFn = FILE_COLORS[annotated.sourceIndex % FILE_COLORS.length]!;
          console.log(colorFn(`${key}=${masked}`));
        } else {
          console.log(`${key}=${masked}`);
        }
      }

      if (unsets.length > 0) {
        console.log();
        for (const u of unsets) {
          if (multiFile) {
            const colorFn = FILE_COLORS[u.sourceIndex % FILE_COLORS.length]!;
            console.log(`${colorFn(pc.strikethrough(u.key))}  ${pc.dim(`UNSET by ${u.unsetBy}`)}`);
          } else {
            console.log(`${pc.strikethrough(pc.dim(u.key))}  ${pc.dim(`UNSET by ${u.unsetBy}`)}`);
          }
        }
      }
    }
  });
