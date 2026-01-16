#!/usr/bin/env bun
import { Command } from "commander";
import pkg from "./package.json";
import { listCommand } from "./src/commands/list";
import { switchCommand } from "./src/commands/switch";
import { initCommand } from "./src/commands/init";
import { setCommand } from "./src/commands/set";
import { resetCommand } from "./src/commands/reset";

const program = new Command();

program
  .name("quickenv")
  .description("Manage environment variables across monorepos")
  .version(pkg.version);

program.addCommand(initCommand);
program.addCommand(listCommand);
program.addCommand(switchCommand);
program.addCommand(setCommand);
program.addCommand(resetCommand);

program.parse();
