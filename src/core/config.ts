import { z } from "zod";
import YAML from "yaml";
import { join, isAbsolute, dirname } from "path";
import { writePrivateFileAtomic } from "./files";
import {
  isEnvQuickYamlPath,
  parseEnvQuickSource,
  parseEnvQuickYamlSources,
  type QuickEnvSection,
  serializeEnvQuick,
} from "./parser";

const ConfigSchema = z.object({
  projects: z.array(z.union([
    z.string(),
    z.object({
      path: z.string(),
      target: z.string().optional() // e.g. .env, .env.local
    })
  ])).nullish().transform(v => v ?? []),
  defaultTarget: z.string().optional(),
  presets: z.record(z.string(), z.object({
    target: z.string().optional(),
    protected: z.boolean().optional()
  })).nullish().transform(v => v ?? {}),
  variables: z.record(z.string(), z.object({
    sensitive: z.boolean().optional(),
    revealPattern: z.string().optional(),
    maskGroups: z.array(z.number()).optional()
  })).nullish().transform(v => v ?? {}),
  tui: z.any().optional()
});

export type Config = z.infer<typeof ConfigSchema>;

const StateSchema = z.object({
  activePreset: z.string().optional(),
  envPath: z.union([z.string(), z.array(z.string())]).optional(),
  isProtected: z.boolean().optional()
}).passthrough();

export type State = z.infer<typeof StateSchema>;

const DEFAULT_STATE_PATH = ".quickenv/.quickenv.state";

interface EnvPathResult {
  path: string;
  paths: string[];  // All resolved paths (for array support)
  isCustom: boolean;
  fallbackFrom?: string;
}

export async function resolveEnvQuickPath(statePath = DEFAULT_STATE_PATH): Promise<EnvPathResult> {
  const state = await loadState(statePath);
  
  // Calculate the base directory (repo root) based on statePath location
  // If statePath ends with .quickenv/.quickenv.state, the repo root is the directory containing .quickenv
  const baseDir = statePath.endsWith(".quickenv/.quickenv.state")
    ? statePath.slice(0, -".quickenv/.quickenv.state".length)
    : dirname(statePath);
  
  const defaultYamlPath = join(baseDir, ".quickenv/.env.quick.yaml");
  const defaultLegacyPath = join(baseDir, ".quickenv/.env.quick");

  const resolveDefaultPath = async (): Promise<string> => {
    if (await Bun.file(defaultYamlPath).exists()) return defaultYamlPath;
    if (await Bun.file(defaultLegacyPath).exists()) return defaultLegacyPath;
    return defaultYamlPath;
  };
  
  if (state.envPath) {
    // Normalize envPath to an array
    const envPaths = Array.isArray(state.envPath) ? state.envPath : [state.envPath];
    
    // Resolve all paths
    const resolvedPaths = envPaths.map(p => isAbsolute(p) ? p : join(baseDir, p));
    
    // Filter to only existing paths
    const existingPaths: string[] = [];
    for (const path of resolvedPaths) {
      if (await Bun.file(path).exists()) {
        existingPaths.push(path);
      }
    }
    
    // If any custom paths exist, use them (last one is primary for backward compat)
    if (existingPaths.length > 0) {
      return { 
        path: existingPaths[existingPaths.length - 1]!, 
        paths: existingPaths,
        isCustom: true 
      };
    }
    
    // Custom paths don't exist, fall back to the preferred default source.
    const defaultPath = await resolveDefaultPath();
    if (await Bun.file(defaultPath).exists()) {
      return {
        path: defaultPath,
        paths: [defaultPath],
        isCustom: false,
        fallbackFrom: resolvedPaths[0]
      };
    }

    // Neither exists - return the preferred YAML path so init and errors agree.
    return {
      path: defaultPath,
      paths: [defaultPath],
      isCustom: false,
      fallbackFrom: resolvedPaths[0]
    };
  }

  const defaultPath = await resolveDefaultPath();
  return { path: defaultPath, paths: [defaultPath], isCustom: false };
}

// Load and merge source files, with later files taking precedence.
export async function loadEnvQuickSections(envResult: EnvPathResult): Promise<QuickEnvSection[]> {
  const sectionsMap = new Map<string, Map<string, string>>();
  const sources = await Promise.all(envResult.paths.map(async path => ({
    path,
    content: await Bun.file(path).text(),
  })));

  // YAML sources are semantic overlays. Merge them before inheritance and shared
  // imports are resolved so later shared values flow through inherited usages.
  if (sources.length > 0 && sources.every(source => isEnvQuickYamlPath(source.path))) {
    return parseEnvQuickYamlSources(sources.map(source => source.content));
  }

  for (const { path, content } of sources) {
    const sections = parseEnvQuickSource(content, path);
    
    for (const section of sections) {
      const tagKey = section.tags.join(',');
      if (!sectionsMap.has(tagKey)) {
        sectionsMap.set(tagKey, new Map());
      }
      const varMap = sectionsMap.get(tagKey)!;
      
      // Later values override earlier ones
      for (const [key, value] of Object.entries(section.variables)) {
        varMap.set(key, value);
      }
    }
  }
  
  const mergedSections: QuickEnvSection[] = [];
  for (const [tagKey, varMap] of sectionsMap) {
    const tags = tagKey ? tagKey.split(',') : [];
    const variables: Record<string, string> = {};
    for (const [key, value] of varMap) {
      variables[key] = value;
    }
    mergedSections.push({ tags, variables });
  }

  return mergedSections;
}

/** Legacy-compatible text loader. New code should use loadEnvQuickSections. */
export async function loadMergedEnvQuick(envResult: EnvPathResult): Promise<string> {
  return serializeEnvQuick(await loadEnvQuickSections(envResult));
}

export async function readConfig(path = "quickenv.yaml"): Promise<Config | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return ConfigSchema.parse(YAML.parse(await file.text()));
}

export async function loadConfig(path = "quickenv.yaml"): Promise<Config | null> {
  try {
    return await readConfig(path);
  } catch (e) {
    if (e instanceof z.ZodError) {
      console.error(`\nInvalid configuration in ${path}:`);
      e.issues.forEach(issue => {
        const issuePath = issue.path.join(".");
        console.error(`  - ${issuePath ? issuePath + ": " : ""}${issue.message}`);
      });
      process.exit(1);
    }
    throw e;
  }
}

export async function readState(path = DEFAULT_STATE_PATH): Promise<State> {
  const file = Bun.file(path);
  if (!(await file.exists())) return {};
  return StateSchema.parse(await file.json());
}

export async function loadState(path = DEFAULT_STATE_PATH): Promise<State> {
  try {
    return await readState(path);
  } catch {
    console.warn(`Warning: Failed to parse ${path}. Using default state.`);
    return {};
  }
}

export async function saveState(state: State, path = DEFAULT_STATE_PATH): Promise<void> {
  await writePrivateFileAtomic(path, JSON.stringify(state, null, 2));
}
