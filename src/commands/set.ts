import { Command } from "commander";
import { loadConfig, loadState, resolveEnvQuickPath, loadEnvQuickSections } from "../core/config";
import { performSwitch } from "./switch";
import { updateEnvQuickContent, type QuickEnvSection } from "../core/parser";
import { resolveEnv } from "../core/resolver";
import { join } from "path";

export const setCommand = new Command("set")
  .description("Updates a variable across projects/presets")
  .argument("<key>", "Variable name")
  .argument("[value]", "Variable value")
  .option("-p, --persist", "Persist change to the environment source")
  .option("--preset <preset>", "Target preset (defaults to active)")
  .action(async (key, value, options) => {
      const state = await loadState();
      const config = await loadConfig();
      
      if (!config) {
          console.error("quickenv.yaml not found.");
          process.exit(1);
      }
      
      const activePreset = state.activePreset;
      if (!activePreset) {
          console.error("No active preset.");
          process.exit(1);
      }
      
      const targetPreset = options.preset || activePreset;
      const val = value === undefined ? "" : value;

      if (options.persist) {
          // Update the last source file in the array because it has highest precedence.
          let content = "";
          const envResult = await resolveEnvQuickPath();
          const envPath = envResult.path; // Last path in array (highest precedence)
          const file = Bun.file(envPath);
          if (await file.exists()) {
              content = await file.text();
          }
          
          const updated = updateEnvQuickContent(content, envPath, [{
              preset: targetPreset,
              variables: { [key]: val },
          }]);
          await Bun.write(envPath, updated);
          console.log(`Persisted ${key}=${val} to ${envPath} for preset '${targetPreset}'`);
          
          if (targetPreset === activePreset) {
              await performSwitch(activePreset);
          }
      } else {
          // Ephemeral update
          console.log("Applying temporary update...");
          
          const envResult = await resolveEnvQuickPath();
          let sections: QuickEnvSection[] = [];
          if (envResult.paths.length > 0 && await Bun.file(envResult.paths[0]!).exists()) {
              sections = await loadEnvQuickSections(envResult);
          }
          
          const projects = config.projects || [];
           for (const proj of projects) {
            let path: string;
            let target = config.defaultTarget || ".env";
            
            if (typeof proj === "string") {

                path = proj;
            } else {
                path = proj.path;
                if (proj.target) target = proj.target;
            }
            
            const projectKey = path;
            const vars = resolveEnv(sections, activePreset, projectKey);
            
            // Override
            if (val === "") {
                delete vars[key];
            } else {
                vars[key] = val;
            }
            
            const lines = Object.entries(vars).map(([k, v]) => `${k}=${v}`);
            const fileContent = lines.join("\n") + "\n";
            const targetPath = join(path, target);
            
            await Bun.write(targetPath, fileContent);
            console.log(`Updated ${targetPath}`);
          }
      }
  });
