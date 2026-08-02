import { Command } from "commander";
import * as p from "@clack/prompts";
import ignore from "ignore";
import { join, relative, dirname, basename } from "path";
import { readdir } from "node:fs/promises";
import { stat } from "node:fs/promises";
import YAML from "yaml";
import {
    loadConfig,
    loadEnvQuickSections,
    type Config,
    resolveEnvQuickPath,
} from "../core/config";
import { updateEnvQuickContent, type EnvQuickUpdate } from "../core/parser";

async function scanFiles(dir: string, ig: any, rootDir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const results: string[] = [];
    
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relPath = relative(rootDir, fullPath);
        
        if (entry.name === '.git' || entry.name === 'node_modules') continue;

        if (entry.isDirectory()) {
             // Check if directory is ignored. 
             // We append '/' to ensure it's treated as a directory by 'ignore' package if needed,
             // though usually relative path is enough if it matches a dir pattern.
             if (ig.ignores(relPath) || ig.ignores(relPath + '/')) {
                 continue;
             }
             results.push(...await scanFiles(fullPath, ig, rootDir));
        } else {
            // We are looking for .env files
            if (entry.name.startsWith('.env')) {
                results.push(fullPath);
            }
        }
    }
    return results;
}

export async function performScan(rootDir: string, options: { yes?: boolean } = {}) {
    p.intro("quickenv scan");

    const gitignorePath = join(rootDir, ".gitignore");
    const ig = ignore();
    
    if (await Bun.file(gitignorePath).exists()) {
        const content = await Bun.file(gitignorePath).text();
        ig.add(content);
    }

    p.log.info("Scanning for .env files...");
    const envFiles = await scanFiles(rootDir, ig, rootDir);
    
    if (envFiles.length === 0) {
        p.log.warn("No .env files found.");
        return;
    }

    p.log.info(`Found ${envFiles.length} .env files.`);

    const projectsFound = new Set<string>();
    const envUpdates: { project?: string; preset: string; variables: Record<string, string> }[] = [];

    for (const file of envFiles) {
        const relPath = relative(rootDir, file);
        const dir = dirname(relPath);
        const filename = basename(file);
        
        // Determine project
        let project: string | undefined = dir;
        if (dir === ".") {
            project = undefined; // Root
            projectsFound.add(".");
        } else {
            projectsFound.add(dir);
        }

        // Determine preset
        // .env -> local (default base)
        // .env.local -> local
        // .env.production -> production
        // .env.test -> test
        // .env.development -> development
        
        let preset = "local"; // default
        if (filename === ".env") {
            preset = "local";
        } else if (filename.startsWith(".env.")) {
            preset = filename.substring(5); // remove .env.
        }

        // Read variables
        const content = await Bun.file(file).text();
        const variables: Record<string, string> = {};
        
        // Simple dotenv parsing
        content.split("\n").forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) return;
            const eqIdx = trimmed.indexOf("=");
            if (eqIdx > -1) {
                const key = trimmed.substring(0, eqIdx).trim();
                const val = trimmed.substring(eqIdx + 1).trim();
                variables[key] = val;
            }
        });

        if (Object.keys(variables).length > 0) {
            envUpdates.push({ project, preset, variables });
        }
    }

    // 1. Update quickenv.yaml
    const configPath = join(rootDir, "quickenv.yaml");
    const loadedConfig = await loadConfig(configPath);
    const config: Config = loadedConfig ?? { projects: [], presets: {}, variables: {} };
    
    // Normalize existing projects to strings or paths
    const existingProjectPaths = new Set(config.projects.map(p => typeof p === 'string' ? p : p.path));
    let configChanged = false;

    for (const proj of projectsFound) {
        if (!existingProjectPaths.has(proj)) {
            config.projects.push(proj);
            configChanged = true;
        }
    }

    if (configChanged) {
        p.log.info(`Adding ${projectsFound.size} projects to quickenv.yaml`);
        if (options.yes || await p.confirm({ message: "Update quickenv.yaml?" })) {
             const yamlStr = YAML.stringify(config);
             await Bun.write(configPath, yamlStr);
             p.log.success("Updated quickenv.yaml");
        }
    } else {
        p.log.info("No new projects to add to quickenv.yaml");
    }

    // 2. Update the preferred environment source.
    const envResult = await resolveEnvQuickPath(join(rootDir, ".quickenv/.quickenv.state"));
    const quickPath = envResult.path;
    const quickFile = Bun.file(quickPath);
    const quickFileExists = await quickFile.exists();
    const quickContent = quickFileExists ? await quickFile.text() : "";
    const mergedEffectiveSections = quickFileExists
        ? await loadEnvQuickSections(envResult)
        : [];
    const updates: EnvQuickUpdate[] = envUpdates.map(update => ({
        preset: update.preset,
        project: update.project,
        variables: update.variables,
    }));
    const newContent = updateEnvQuickContent(
        quickContent,
        quickPath,
        updates,
        { onlyIfMissing: true, mergedEffectiveSections },
    );
    const envChanged = newContent !== quickContent;

    if (envChanged) {
        p.log.info("Found new variables from .env files.");
        if (options.yes || await p.confirm({ message: `Update ${quickPath} with found variables?` })) {
            await Bun.write(quickPath, newContent);
            p.log.success(`Updated ${quickPath}`);
        }
    } else {
        p.log.info(`No new variables to add to ${quickPath}`);
    }

    p.outro("Scan complete!");
}

export const scanCommand = new Command("scan")
    .description("Scan for existing .env files and populate quickenv configuration")
    .option("-y, --yes", "Skip confirmation")
    .action(async (options) => {
        await performScan(process.cwd(), options);
    });
