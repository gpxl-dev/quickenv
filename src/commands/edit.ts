import { Command } from "commander";
import { resolveEnvQuickPath } from "../core/config";
import { spawn } from "child_process";

export const editCommand = new Command("edit")
  .description("Opens the .env.quick file in your default editor")
  .action(async () => {
    const envResult = await resolveEnvQuickPath();
    const envPath = envResult.path;
    const envFile = Bun.file(envPath);
    
    if (!(await envFile.exists())) {
      if (envResult.isCustom) {
        console.error(`${envPath} not found (custom path from .quickenv.state). Run 'quickenv init'.`);
      } else if (envResult.fallbackFrom) {
        console.error(`${envResult.fallbackFrom} not found (custom path from .quickenv.state), and default location ${envPath} not found. Run 'quickenv init'.`);
      } else {
        console.error(`${envPath} not found. Run 'quickenv init'.`);
      }
      process.exit(1);
    }

    const editor = process.env.VISUAL || process.env.EDITOR || (process.platform === "win32" ? "notepad" : "vi");
    
    // Using child_process.spawn with stdio: inherit to handle interactive editors like vim/nano
    const child = spawn(editor, [envPath], {
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      process.exit(code || 0);
    });

    child.on("error", (err) => {
      console.error(`Failed to start editor (${editor}): ${err.message}`);
      process.exit(1);
    });
  });
