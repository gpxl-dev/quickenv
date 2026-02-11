import { Command } from "commander";
import { loadState } from "../core/config";
import { performSwitch } from "./switch";
import { join } from "path";

export const reloadCommand = new Command("reload")
    .description("Reloads the current preset without prompting")
    .action(async () => {
        const rootDir = process.cwd();
        const statePath = join(rootDir, ".quickenv.state");
        const state = await loadState(statePath);
        
        if (!state.activePreset) {
            console.error("No active preset found. Run 'quickenv switch' first.");
            process.exit(1);
        }
        
        await performSwitch(state.activePreset, rootDir);
    });
