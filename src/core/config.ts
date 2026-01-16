import { z } from "zod";
import YAML from "yaml";
import { join, isAbsolute } from "path";

export const ConfigSchema = z.object({
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

export const StateSchema = z.object({
  activePreset: z.string().optional(),
  envPath: z.string().optional(),
  isProtected: z.boolean().optional()
});

export type State = z.infer<typeof StateSchema>;

export async function resolveEnvQuickPath(statePath = ".quickenv.state"): Promise<string> {
  const state = await loadState(statePath);
  if (state.envPath) {
    if (isAbsolute(state.envPath)) {
      return state.envPath;
    }
    // Relative to the directory containing the state file
    const baseDir = statePath.endsWith(".quickenv.state") 
      ? statePath.slice(0, -".quickenv.state".length) 
      : "";
    return join(baseDir, state.envPath);
  }
  
  const baseDir = statePath.endsWith(".quickenv.state") 
    ? statePath.slice(0, -".quickenv.state".length) 
    : "";
  return join(baseDir, ".env.quick");
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

export async function loadState(path = ".quickenv.state"): Promise<State> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return {};
  }
  try {
    const json = await file.json();
    return StateSchema.parse(json);
  } catch (e) {
    // If invalid state, return empty
    return {};
  }
}

export async function saveState(state: State, path = ".quickenv.state"): Promise<void> {
  await Bun.write(path, JSON.stringify(state, null, 2));
}
