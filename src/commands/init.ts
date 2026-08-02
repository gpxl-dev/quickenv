import { Command } from "commander";
import * as p from "@clack/prompts";
import ignore from "ignore";
import { join, dirname } from "path";
import { $ } from "bun";
import YAML from "yaml";
import { resolveEnvQuickPath } from "../core/config";

export const initCommand = new Command("init")
    .description("Guided setup to bootstrap quickenv in a repository")
    .action(async () => {
        p.intro("quickenv setup");

        const projects = new Set<string>();
        
        // 1. Check package.json workspaces
        const pkgPath = Bun.file("package.json");
        if (await pkgPath.exists()) {
             try {
                 const pkg = await pkgPath.json();
                 if (pkg.workspaces) {
                     const patterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages;
                     if (Array.isArray(patterns)) {
                        for (const pattern of patterns) {
                            // Pattern might be "apps/*"
                            // Bun.Glob expects simple patterns usually.
                            const glob = new Bun.Glob(pattern);
                            for await (const match of glob.scan()) {
                                // Match is relative path like "apps/web"
                                // Verify it's a dir (has package.json?)
                                const pkgJson = Bun.file(join(match, "package.json"));
                                if (await pkgJson.exists()) {
                                    projects.add(match);
                                }
                            }
                        }
                     }
                 }
             } catch (e) {
                 p.log.warn("Failed to parse package.json");
             }
        }
        
        // 2. Scan for .env.example
        const exampleGlob = new Bun.Glob("**/.env.example");
        for await (const file of exampleGlob.scan()) {
             if (file.includes("node_modules")) continue;
             const dir = dirname(file);
             // Avoid adding root if it's just the root .env.example (unless root IS a project?)
             // Usually monorepo root isn't a project in the same sense, but it might be.
             if (dir === ".") continue; 
             projects.add(dir);
        }
        
        const projectList = Array.from(projects).sort();
        
        if (projectList.length > 0) {
            p.log.info(`Found ${projectList.length} projects: ${projectList.join(", ")}`);
        } else {
            p.log.info("No projects found automatically.");
        }
        
        // 3. Generate quickenv.yaml
        if (!(await Bun.file("quickenv.yaml").exists())) {
            const projectsExample = `  # Add project paths here (e.g. apps/web)
  # - apps/web
  # - path: apps/api
  #   target: .env.local

# defaultTarget: .env.local`;
            
            const projectLines = projectList.length > 0 
                ? projectList.map(p => `  - ${p}`).join("\n")
                : "";

            const configContent = `projects:
${projectsExample}
${projectLines}${projectLines ? "\n" : ""}
# defaultTarget: .env.local

# presets:
#   production:
#     target: .env.production
#     protected: true
#   staging:
#     target: .env.staging

variables:
  # Add sensitive variables here
  # SECRET_KEY:
  #   sensitive: true
`;
            await Bun.write("quickenv.yaml", configContent);
            p.log.success("Created quickenv.yaml");
        } else {
            p.log.info("quickenv.yaml already exists. Skipping.");
        }
        
        // 4. Create .quickenv directory and the preferred YAML source.
        await $`mkdir -p .quickenv`;
        const envResult = await resolveEnvQuickPath();
        const envPath = envResult.path;
        if (!(await Bun.file(envPath).exists())) {
            const initialVariables: Record<string, string> = { DEBUG: "true" };

            // Pre-fill the local preset from a root example when available.
            const rootExample = Bun.file(".env.example");
            if (await rootExample.exists()) {
                const content = await rootExample.text();
                for (const line of content.split(/\r?\n/)) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith("#")) continue;
                    const equals = trimmed.indexOf("=");
                    if (equals === -1) continue;
                    initialVariables[trimmed.slice(0, equals).trim()] = trimmed.slice(equals + 1).trim();
                }
            }

            const initialEnvContent = YAML.stringify({
                local: {
                    "*": initialVariables,
                },
            });
            await Bun.write(envPath, initialEnvContent);
            p.log.success(`Created ${envPath}`);
        } else {
            p.log.info(`${envPath} already exists. Skipping.`);
        }

        // 5. Update .gitignore
        const gitignore = Bun.file(".gitignore");
        let content = "";
        const exists = await gitignore.exists();

        if (exists) {
            content = await gitignore.text();
        }

        const ig = ignore().add(content);
        let updated = false;

        if (!ig.ignores(".quickenv")) {
            if (content.length > 0 && !content.endsWith("\n")) content += "\n";
            content += "# quickenv\n.quickenv\n";
            updated = true;
            p.log.success("Added .quickenv to .gitignore");
        }

        if (updated) {
            await Bun.write(".gitignore", content);
            if (!exists) {
                p.log.success("Created .gitignore");
            }
        }
        
        p.outro("Setup complete! Run 'quickenv switch' to start.");
    });
