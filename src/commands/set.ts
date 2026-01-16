import { Command } from "commander";
import { loadConfig, loadState, resolveEnvQuickPath } from "../core/config";
import { performSwitch } from "./switch";
import { parseEnvQuick, type QuickEnvSection } from "../core/parser";
import { resolveEnv } from "../core/resolver";
import { join } from "path";

export const setCommand = new Command("set")
  .description("Updates a variable across projects/presets")
  .argument("<key>", "Variable name")
  .argument("[value]", "Variable value")
  .option("-p, --persist", "Persist change to the environment file (e.g. .env.quick)")
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
          // Append to .env.quick
          
          let content = "";
          const envPath = await resolveEnvQuickPath();
          const file = Bun.file(envPath);
          if (await file.exists()) {
              content = await file.text();
          }
          
          const append = `\n[${targetPreset}]\n${key}=${val}\n`;
          await Bun.write(envPath, content + append);
          console.log(`Persisted ${key}=${val} to ${envPath} for preset '${targetPreset}'`);
          
          if (targetPreset === activePreset) {
              await performSwitch(activePreset);
          }
      } else {
          // Ephemeral update
          console.log("Applying temporary update...");
          
          const envPath = await resolveEnvQuickPath();
          const envFile = Bun.file(envPath);
          let sections: QuickEnvSection[] = [];
          if (await envFile.exists()) {
              const content = await envFile.text();
              sections = parseEnvQuick(content);
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
