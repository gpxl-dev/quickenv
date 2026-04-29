import { z } from "zod";
import YAML from "yaml";
import { join, isAbsolute, dirname } from "path";
import { parseEnvQuick, type QuickEnvSection, serializeEnvQuick } from "./parser";

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
});

type State = z.infer<typeof StateSchema>;

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
  
  const defaultPath = join(baseDir, ".quickenv/.env.quick");
  
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
    
    // Custom paths don't exist, fall back to default
    const defaultFile = Bun.file(defaultPath);
    if (await defaultFile.exists()) {
      return { 
        path: defaultPath, 
        paths: [defaultPath],
        isCustom: false, 
        fallbackFrom: resolvedPaths[0] 
      };
    }
    
    // Neither exists - return first custom path for error reporting
    return { 
      path: resolvedPaths[0]!, 
      paths: resolvedPaths,
      isCustom: true 
    };
  }

  // Default location is .quickenv/.env.quick relative to the base directory
  return { path: defaultPath, paths: [defaultPath], isCustom: false };
}

// Load and merge multiple env.quick files, with later files taking precedence
export async function loadMergedEnvQuick(envResult: EnvPathResult): Promise<string> {
  if (envResult.paths.length === 1) {
    return await Bun.file(envResult.paths[0]!).text();
  }
  
  // Merge multiple files - later files override earlier ones
  const sectionsMap = new Map<string, Map<string, string>>();
  
  for (const path of envResult.paths) {
    const content = await Bun.file(path).text();
    const sections = parseEnvQuick(content);
    
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
  
  // Rebuild the merged content
  const mergedSections: QuickEnvSection[] = [];
  for (const [tagKey, varMap] of sectionsMap) {
    const tags = tagKey ? tagKey.split(',') : [];
    const variables: Record<string, string> = {};
    for (const [key, value] of varMap) {
      variables[key] = value;
    }
    mergedSections.push({ tags, variables });
  }
  
  // Serialize back to string format
  return serializeEnvQuick(mergedSections);
}

export async function loadConfig(path = "quickenv.yaml"): Promise<Config | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return null;
  }
  const text = await file.text();
  try {
    const raw = YAML.parse(text);
    return ConfigSchema.parse(raw);
  } catch (e) {
    if (e instanceof z.ZodError) {
      console.error(`\nInvalid configuration in ${path}:`);
      e.issues.forEach(issue => {
        const path = issue.path.join(".");
        console.error(`  - ${path ? path + ": " : ""}${issue.message}`);
      });
      process.exit(1);
    }
    throw e;
  }
}

export async function loadState(path = DEFAULT_STATE_PATH): Promise<State> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return {};
  }
  try {
    const json = await file.json();
    return StateSchema.parse(json);
  } catch (e) {
    // If invalid state, warn and return empty
    console.warn(`Warning: Failed to parse ${path}. Using default state.`);
    return {};
  }
}

export async function saveState(state: State, path = DEFAULT_STATE_PATH): Promise<void> {
  await Bun.write(path, JSON.stringify(state, null, 2));
}
