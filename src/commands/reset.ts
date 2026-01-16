import { Command } from "commander";
import { loadState } from "../core/config";
import { performSwitch } from "./switch";

export const resetCommand = new Command("reset")
  .description("Reverts local project .env files to match exactly what is defined in the current environment preset")
  .action(async () => {
      const state = await loadState();
      if (!state.activePreset) {
          console.error("No active preset. Use 'quickenv switch' first.");
          process.exit(1);
      }
      
      console.log(`Resetting environment to preset '${state.activePreset}'...`);
      await performSwitch(state.activePreset);
  });
