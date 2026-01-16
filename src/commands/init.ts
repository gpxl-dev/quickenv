import { Command } from "commander";
import * as p from "@clack/prompts";
import { join, dirname } from "path";

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
            const configContent = `projects:
${projectList.map(p => `  - ${p}`).join("\n")}

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
        
        // 4. Generate .env.quick
        if (!(await Bun.file(".env.quick").exists())) {
            let initialEnvContent = `# Shared variables
# [local, production]
# NODE_ENV=development

[local]
# Add local overrides here
`;
            // Try to pre-fill from an example if available
            // Just picking the first found example for demo purposes
            // Or maybe searching for root .env.example
            const rootExample = Bun.file(".env.example");
            if (await rootExample.exists()) {
                const content = await rootExample.text();
                initialEnvContent += `\n# Imported from .env.example\n${content}`;
            }

            await Bun.write(".env.quick", initialEnvContent);
            p.log.success("Created .env.quick");
        } else {
            p.log.info(".env.quick already exists. Skipping.");
        }
        
        // 5. Update .gitignore
        const gitignore = Bun.file(".gitignore");
        if (await gitignore.exists()) {
            let content = await gitignore.text();
            if (!content.includes(".quickenv.state")) {
                content += "\n# quickenv state\n.quickenv.state\n";
                await Bun.write(".gitignore", content);
                p.log.success("Added .quickenv.state to .gitignore");
            }
        } else {
             await Bun.write(".gitignore", ".quickenv.state\n");
             p.log.success("Created .gitignore with .quickenv.state");
        }
        
        p.outro("Setup complete! Run 'quickenv switch' to start.");
    });
