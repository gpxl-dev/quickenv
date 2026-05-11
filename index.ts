#!/usr/bin/env bun
import { Command } from "commander";
import pkg from "./package.json";
import { listCommand } from "./src/commands/list";
import { switchCommand } from "./src/commands/switch";
import { reloadCommand } from "./src/commands/reload";
import { initCommand } from "./src/commands/init";
import { setCommand } from "./src/commands/set";
import { resetCommand } from "./src/commands/reset";
import { scanCommand } from "./src/commands/scan";
import { editCommand } from "./src/commands/edit";
import { helpCommand } from "./src/commands/help";
import { statusCommand } from "./src/commands/status";
import { worktreeCommand } from "./scripts/create-worktree";
import { useNearestQuickenvRoot } from "./src/core/root";

const program = new Command();

program
  .name("quickenv")
  .description("Manage environment variables across monorepos")
  .version(pkg.version)
  .option("--no-traversal", "Do not search parent directories for a quickenv root");

program.hook("preAction", async (thisCommand, actionCommand) => {
  // `quickenv init` intentionally initializes the current directory. All other
  // commands operate from the nearest parent quickenv root unless disabled.
  if (actionCommand.name() === "init") return;

  await useNearestQuickenvRoot({
    noTraversal: thisCommand.optsWithGlobals().traversal === false,
  });
});

program.addCommand(initCommand);
program.addCommand(scanCommand);
program.addCommand(listCommand);
program.addCommand(switchCommand);
program.addCommand(reloadCommand);
program.addCommand(setCommand);
program.addCommand(editCommand);
program.addCommand(resetCommand);
program.addCommand(statusCommand);
program.addCommand(helpCommand);
program.addCommand(worktreeCommand);

program.parse();
