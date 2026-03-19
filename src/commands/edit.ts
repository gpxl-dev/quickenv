import { Command } from "commander";
import * as p from "@clack/prompts";
import { resolveEnvQuickPath } from "../core/config";
import { spawn } from "child_process";

export const editCommand = new Command("edit")
  .description("Opens the .env.quick file in your default editor")
  .action(async () => {
    const envResult = await resolveEnvQuickPath();

    // Filter to only existing paths
    const existingPaths: string[] = [];
    for (const path of envResult.paths) {
      if (await Bun.file(path).exists()) {
        existingPaths.push(path);
      }
    }

    if (existingPaths.length === 0) {
      if (envResult.isCustom) {
        console.error(`${envResult.path} not found (custom path from .quickenv.state). Run 'quickenv init'.`);
      } else if (envResult.fallbackFrom) {
        console.error(`${envResult.fallbackFrom} not found (custom path from .quickenv.state), and default location ${envResult.path} not found. Run 'quickenv init'.`);
      } else {
        console.error(`${envResult.path} not found. Run 'quickenv init'.`);
      }
      process.exit(1);
    }

    let targetPath: string;

    if (existingPaths.length > 1) {
      const selected = await p.select({
        message: "Multiple env files found. Which file do you want to edit?",
        options: existingPaths.map(path => ({ value: path, label: path })),
      });

      if (p.isCancel(selected)) {
        process.exit(0);
      }

      targetPath = selected as string;
    } else {
      targetPath = existingPaths[0]!;
    }

    const editor = process.env.VISUAL || process.env.EDITOR || (process.platform === "win32" ? "notepad" : "vi");

    // Using child_process.spawn with stdio: inherit to handle interactive editors like vim/nano
    const child = spawn(editor, [targetPath], {
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
