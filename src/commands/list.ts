import { Command } from "commander";
import { loadConfig, loadState, resolveEnvQuickPath, loadMergedEnvQuick } from "../core/config";
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
    const content = await loadMergedEnvQuick(envResult);
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
