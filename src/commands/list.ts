import { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadConfig, loadState, resolveEnvQuickPath, loadMergedEnvQuick } from "../core/config";
import { parseEnvQuick } from "../core/parser";
import { resolveEnv } from "../core/resolver";
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
      Object.entries(s.variables).map(([k, v]) => [k, { value: v, sourceIndex }])
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

function resolveEnvWithSources(
  sections: AnnotatedSection[],
  preset: string,
  project?: string
): Record<string, AnnotatedVariable> {
  const result: Record<string, AnnotatedVariable> = {};

  const applyVariables = (variables: Record<string, AnnotatedVariable>) => {
    for (const [key, annotated] of Object.entries(variables)) {
      if (annotated.value === "" || annotated.value === "UNSET") {
        delete result[key];
      } else {
        result[key] = annotated;
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

export const listCommand = new Command("list")
  .alias("show")
  .description("Displays the effective environment variables for the current active preset")
  .argument("[app]", "Project/app to list variables for (path or name)")
  .option("-s, --suffix <preset>", "View values for a specific preset without switching")
  .action(async (appArg: string | undefined, options) => {
    const config = await loadConfig();
    const state = await loadState();

    const preset = options.suffix || state.activePreset;

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

    if (multiFile) {
      // Multi-file: resolve with source tracking
      const fileContents: Array<{ content: string; sourceIndex: number }> = [];
      for (let i = 0; i < envResult.paths.length; i++) {
        const content = await Bun.file(envResult.paths[i]!).text();
        fileContents.push({ content, sourceIndex: i });
      }

      const annotatedSections = mergeAnnotatedSections(fileContents);
      const variables = resolveEnvWithSources(annotatedSections, preset, selectedProject);

      if (Object.keys(variables).length === 0) {
        console.log(`No variables defined for preset '${preset}'${projectLabel}.`);
        return;
      }

      console.log(`\nEnvironment variables for preset '${preset}'${projectLabel}:\n`);

      // Print file legend
      console.log(pc.dim("Sources:"));
      for (let i = 0; i < envResult.paths.length; i++) {
        const colorFn = FILE_COLORS[i % FILE_COLORS.length]!;
        console.log(`  ${colorFn("●")} ${envResult.paths[i]}`);
      }
      console.log();

      for (const [key, annotated] of Object.entries(variables)) {
        const masked = maskValue(key, annotated.value, config);
        const colorFn = FILE_COLORS[annotated.sourceIndex % FILE_COLORS.length]!;
        console.log(colorFn(`${key}=${masked}`));
      }
    } else {
      // Single file: simple output
      const content = await loadMergedEnvQuick(envResult);
      const sections = parseEnvQuick(content);
      const variables = resolveEnv(sections, preset, selectedProject);

      if (Object.keys(variables).length === 0) {
        console.log(`No variables defined for preset '${preset}'${projectLabel}.`);
        return;
      }

      console.log(`\nEnvironment variables for preset '${preset}'${projectLabel}:\n`);
      for (const [key, value] of Object.entries(variables)) {
        const masked = maskValue(key, value, config);
        console.log(`${key}=${masked}`);
      }
    }
  });
