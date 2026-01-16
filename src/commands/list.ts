import { Command } from "commander";
import { loadConfig, loadState } from "../core/config";
import { parseEnvQuick } from "../core/parser";
import { resolveEnv } from "../core/resolver";
import { maskValue } from "../core/masking";

export const listCommand = new Command("list")
  .alias("show")
  .description("Displays the effective environment variables for the current active preset")
  .option("-s, --suffix <preset>", "View values for a specific preset without switching")
  .action(async (options) => {
    const config = await loadConfig();
    const state = await loadState();
    
    const preset = options.suffix || state.activePreset;
    
    if (!preset) {
      console.error("No active preset found. Use 'quickenv switch' or provide --suffix.");
      process.exit(1);
    }
    
    const envFile = Bun.file(".env.quick");
    if (!(await envFile.exists())) {
      console.error(".env.quick not found. Run 'quickenv init'.");
      process.exit(1);
    }
    const content = await envFile.text();
    const sections = parseEnvQuick(content);
    
    const variables = resolveEnv(sections, preset);
    
    if (Object.keys(variables).length === 0) {
      console.log(`No variables defined for preset '${preset}'.`);
      return;
    }
    
    console.log(`Environment variables for preset '${preset}':\n`);
    for (const [key, value] of Object.entries(variables)) {
      const masked = maskValue(key, value, config);
      console.log(`${key}=${masked}`);
    }
  });
