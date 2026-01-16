import { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";

export const helpCommand = new Command("man")
    .description("Display detailed documentation in a manpage-like format")
    .action(() => {
        const bold = (txt: string) => pc.bold(txt);
        const underline = (txt: string) => pc.underline(txt);
        const blue = (txt: string) => pc.blue(txt);
        const green = (txt: string) => pc.green(txt);

        console.log(`
${bold("NAME")}
     ${bold("quickenv")} -- manage environment variables across monorepos

${bold("SYNOPSIS")}
     ${bold("quickenv")} [${underline("command")}] [${underline("options")}]

${bold("DESCRIPTION")}
     ${bold("quickenv")} simplifies the management of .env files in monorepos by centralizing 
     configuration in a single ${blue(".env.quick")} file and distributing them to 
     relevant project directories.

${bold("FILES")}
     ${bold("quickenv.yaml")}
         The main configuration file. It defines where environment variables 
         should be synced and how they should be handled.

         ${underline("The variables section:")}
         Used to define metadata for specific environment variables.
         
         ${green("variables:")}
         ${green("  SECRET_KEY:")}
         ${green("    sensitive: true")}

         Setting ${underline("sensitive: true")} ensures that the variable's value is 
         masked or handled securely (e.g., during logs or display).

         ${underline("The projects section:")}
         Defines which directories should receive environment variables.
         Each project can specify a custom ${underline("target")} filename.

         ${green("projects:")}
         ${green("  - path: apps/web")}
         ${green("    target: .env.local  # Custom target file")}
         ${green("  - apps/api             # Defaults to .env")}

         ${green("defaultTarget: .env.local  # Global default for all projects")}

         By default, ${bold("quickenv")} writes to ${bold(".env")}. Use ${underline("target")} 
         to change this per project, or ${underline("defaultTarget")} for all.

     ${bold(".env.quick")}
         The source of truth for all environment variables. It supports 
         grouping variables using tags. By default, it is located in the root 
         directory, but the path can be customized in ${bold(".quickenv.state")}.

          ${underline("Tagging System:")}
          Tags are defined in square brackets. Variables following a tag 
          belong to that environment/scope. Wildcards (${bold("*")}) can be used 
          to match all presets or all projects.

          ${green("# Global variables (shared across all environments)")}
          ${green("NODE_ENV=development")}

          ${green("[local]")}
          ${green("# Only applied when 'local' is switched on")}
          ${green("API_URL=http://localhost:3000")}

          ${green("[production, staging]")}
          ${green("# Shared between production and staging environments")}
          ${green("DB_HOST=cloud-db.internal")}

          ${underline("Project and Wildcard Scoping:")}
          You can target specific projects, use wildcards for all presets 
          within a project, or all projects for a specific preset.

          ${green("[apps/web]")}
          ${green("# Constant for 'apps/web' project, regardless of preset")}
          ${green("NEXT_PUBLIC_API_VERSION=v2")}

          ${green("[apps/web:*]")}
          ${green("# Same as [apps/web], matches all presets for this project")}
          ${green("LOG_LEVEL=info")}

          ${green("[*:production]")}
          ${green("# Applied to all projects when 'production' preset is active")}
          ${green("SENTRY_ENABLED=true")}

          ${green("[apps/web:local]")}
          ${green("# Only for 'apps/web' when 'local' preset is active")}
          ${green("DEBUG_LEVEL=verbose")}

          ${underline("Precedence Order:")}
          1. ${bold("Project:Preset")} (e.g. [apps/web:local] or [*:local]) - Highest
          2. ${bold("Preset")} (e.g. [local])
          3. ${bold("Project")} (e.g. [apps/web] or [apps/web:*])
          4. ${bold("Global")} (Untagged at top of file) - Lowest


${bold("COMMANDS")}
     ${bold("init")}       Guided setup to bootstrap quickenv in a repository.
     ${bold("scan")}       Scan for .env.example files to discover projects.
     ${bold("list")}       List all projects and their current environment status.
     ${bold("switch")}     Interactively switch between environments (tags).
     ${bold("set")}        Set a variable in .env.quick and sync it.
     ${bold("edit")}       Open the .env.quick file in your default editor.
     ${bold("reset")}      Remove all managed .env files.

${bold("SEE ALSO")}
     https://github.com/your-repo/quickenv
`);
    });
