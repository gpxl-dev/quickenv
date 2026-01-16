import { Command } from "commander";
import { resolveEnvQuickPath } from "../core/config";
import { spawn } from "child_process";

export const editCommand = new Command("edit")
  .description("Opens the .env.quick file in your default editor")
  .action(async () => {
    const envPath = await resolveEnvQuickPath();
    const envFile = Bun.file(envPath);
    
    if (!(await envFile.exists())) {
      console.error(`${envPath} not found. Run 'quickenv init'.`);
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
