import { Command } from "commander";
import { loadConfig, loadState, resolveEnvQuickPath } from "../core/config";
import { deleteEnvQuickVariable } from "../core/parser";
import { performSwitch } from "./switch";

export const deleteCommand = new Command("delete")
  .description("Deletes a variable definition from an environment source")
  .argument("<key>", "Variable name")
  .option("--preset <preset>", "Target preset (defaults to active)")
  .action(async (key, options) => {
    const [state, config] = await Promise.all([loadState(), loadConfig()]);
    if (!config) {
      console.error("quickenv.yaml not found.");
      process.exit(1);
    }

    const targetPreset = options.preset || state.activePreset;
    if (!targetPreset) {
      console.error("No active preset. Pass --preset <preset>.");
      process.exit(1);
    }

    const envResult = await resolveEnvQuickPath();
    const envPath = envResult.path;
    const file = Bun.file(envPath);
    const content = await file.exists() ? await file.text() : "";
    const updated = deleteEnvQuickVariable(content, envPath, targetPreset, key);

    if (updated === content) {
      console.log(`No definition of ${key} found for preset '${targetPreset}'.`);
      return;
    }

    await Bun.write(envPath, updated);
    console.log(`Deleted ${key} from ${envPath} for preset '${targetPreset}'.`);

    if (targetPreset === state.activePreset) {
      await performSwitch(targetPreset);
    }
  });
