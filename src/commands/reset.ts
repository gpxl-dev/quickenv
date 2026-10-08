import { Command } from "commander";
import { loadState } from "../core/config";
import { performSwitch } from "./switch";

export const resetCommand = new Command("reset")
  .description("Reverts local project .env files to match exactly what is defined in the current environment preset")
  .argument("[project]", "Reset one project by path, basename, or unique partial path")
  .action(async (project?: string) => {
      const state = await loadState();
      if (!state.activePreset) {
          console.error("No active preset. Use 'quickenv switch' first.");
          process.exit(1);
      }
      
      console.log(`Resetting environment to preset '${state.activePreset}'...`);
      await performSwitch(state.activePreset, process.cwd(), project);
  });
