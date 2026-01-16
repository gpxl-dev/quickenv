import { z } from "zod";
import YAML from "yaml";
import { existsSync } from "fs"; // Bun supports node:fs/promises etc, but Bun.file is better.
// But existence check: await Bun.file(path).exists()

export const ConfigSchema = z.object({
  projects: z.array(z.union([
    z.string(),
    z.object({
      path: z.string(),
      target: z.string().optional() // e.g. .env, .env.local
    })
  ])),
  variables: z.record(z.string(), z.object({
    sensitive: z.boolean().optional(),
    revealPattern: z.string().optional(),
    maskGroups: z.array(z.number()).optional()
  })).optional(),
  tui: z.any().optional()
});

export type Config = z.infer<typeof ConfigSchema>;

export const StateSchema = z.object({
  activePreset: z.string().optional()
});

export type State = z.infer<typeof StateSchema>;

export async function loadConfig(path = "quickenv.yaml"): Promise<Config | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return null;
  }
  const text = await file.text();
  const raw = YAML.parse(text);
  return ConfigSchema.parse(raw);
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
