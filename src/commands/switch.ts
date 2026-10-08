import { Command } from "commander";
import * as p from "@clack/prompts";
import { loadConfig, loadState, saveState, resolveEnvQuickPath, loadEnvQuickSections } from "../core/config";
import { getPresetNames } from "../core/parser";
import { resolveEnv } from "../core/resolver";
import { serializeEnvFile } from "../core/envfile";
import { basename, join } from "path";

export async function performSwitch(preset: string, rootDir: string = process.cwd(), projectArg?: string) {
    const configPath = join(rootDir, "quickenv.yaml");
    const config = await loadConfig(configPath);
    if (!config) {
            console.error("quickenv.yaml not found. Run 'quickenv init'.");
            process.exit(1);
    }

    let projects = config.projects || [];
    if (projectArg !== undefined) {
        const projectPaths = projects.map(proj => typeof proj === "string" ? proj : proj.path);
        const exact = projectPaths.filter(path => path === projectArg);
        const byBasename = projectPaths.filter(path => basename(path) === projectArg);
        const matches = exact.length ? exact : byBasename.length ? byBasename
            : projectPaths.filter(path => projectArg.length > 0 && path.includes(projectArg));
        if (matches.length !== 1) {
            console.error(matches.length === 0
                ? `No project matches '${projectArg}'. Available projects: ${projectPaths.join(", ")}`
                : `Ambiguous project '${projectArg}'. Use an exact path: ${matches.join(", ")}`);
            process.exit(1);
        }
        projects = projects.filter(proj => (typeof proj === "string" ? proj : proj.path) === matches[0]);
    }

    const statePath = join(rootDir, ".quickenv/.quickenv.state");
    const envResult = await resolveEnvQuickPath(statePath);
    const envFile = Bun.file(envResult.path);
    if (!(await envFile.exists())) {
        if (envResult.isCustom) {
            console.error(`Environment source not found at ${envResult.path} (custom path from .quickenv.state)`);
        } else if (envResult.fallbackFrom) {
            console.error(`Environment source not found at ${envResult.fallbackFrom} (custom path from .quickenv.state), or at default location ${envResult.path}`);
        } else {
            console.error(`Environment source not found at ${envResult.path}`);
        }
        process.exit(1);
    }

    const sections = await loadEnvQuickSections(envResult);

    const presetNames = getPresetNames(sections);
    if (!presetNames.includes(preset)) {
        console.error(`Preset '${preset}' not found in the environment source. No env files were changed.`);
        if (presetNames.length > 0) {
            console.error(`Available presets: ${presetNames.join(", ")}`);
        }
        process.exit(1);
    }

    const presetConfig = config.presets[preset];
    if (presetConfig?.protected) {
        const confirmed = await p.confirm({
            message: `⚠️  '${preset}' is a protected preset. Are you sure you want to switch?`,
            initialValue: false
        });

        if (p.isCancel(confirmed) || !confirmed) {
            console.log("Switch cancelled.");
            return;
        }
    }

    if (projects.length === 0) {
        console.warn("No projects defined in quickenv.yaml.");
    }
    
    for (const proj of projects) {
        let path: string;
        let target = config.defaultTarget || ".env"; // Default fallback
        
        if (typeof proj === "string") {
            path = proj;
        } else {
            path = proj.path;
            if (proj.target) target = proj.target;
        }

        // Preset target always wins if defined
        if (presetConfig?.target) {
            target = presetConfig.target;
        }
        
        const projectKey = path;
        const vars = resolveEnv(sections, preset, projectKey);

        const targetPath = join(rootDir, path, target);

        await Bun.write(targetPath, serializeEnvFile(vars));
        console.log(`Updated ${targetPath}`);
    }
    
    if (projectArg !== undefined) {
        console.log(`Reset project '${typeof projects[0] === "string" ? projects[0] : projects[0]!.path}' to preset '${preset}'.`);
        return;
    }

    await saveState({ 
        ...await loadState(statePath), 
        activePreset: preset,
        isProtected: !!presetConfig?.protected
    }, statePath);
    console.log(`Switched to preset '${preset}'.`);
}

export const switchCommand = new Command("switch")
    .description("Synchronizes the monorepo to a specific preset")
    .argument("[preset]", "The preset to switch to")
    .action(async (presetArg) => {
        let preset = presetArg;
        
        if (!preset) {
            const envResult = await resolveEnvQuickPath();
            const envFile = Bun.file(envResult.path);
            if (!(await envFile.exists())) {
                if (envResult.isCustom) {
                    console.error(`Environment source not found at ${envResult.path} (custom path from .quickenv.state)`);
                } else if (envResult.fallbackFrom) {
                    console.error(`Environment source not found at ${envResult.fallbackFrom} (custom path from .quickenv.state), or at default location ${envResult.path}`);
                } else {
                    console.error(`Environment source not found at ${envResult.path}`);
                }
                process.exit(1);
            }
            const sections = await loadEnvQuickSections(envResult);
            const presets = getPresetNames(sections);
            
            if (presets.length === 0) {
                console.error("No presets found in the environment source.");
                process.exit(1);
            }
            
            const config = await loadConfig();
            const selected = await p.select({
                message: "Select a preset to switch to:",
                options: presets.map(p => ({ 
                    value: p, 
                    label: config?.presets[p]?.protected ? `🔒 ${p}` : p 
                }))
            });
            
            if (p.isCancel(selected)) {
                process.exit(0);
            }
            preset = selected;
        }
        
        await performSwitch(preset);
    });

