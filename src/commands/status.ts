import { Command } from "commander";
import pc from "picocolors";
import { loadConfig, loadState, resolveEnvQuickPath, loadMergedEnvQuick } from "../core/config";
import { parseEnvQuick, type QuickEnvSection } from "../core/parser";
import { join } from "path";

function getPresets(sections: QuickEnvSection[]): string[] {
  const presets = new Set<string>();
  for (const s of sections) {
    for (const t of s.tags) {
      const parts = t.split(":");
      const presetName = parts.length > 1 ? parts[1]! : parts[0]!;
      if (presetName !== "*") {
        presets.add(presetName);
      }
    }
  }
  return Array.from(presets).sort();
}

export const statusCommand = new Command("status")
  .description("Shows the current quickenv status: active preset, source files, and projects")
  .action(async () => {
    const rootDir = process.cwd();
    const configPath = join(rootDir, "quickenv.yaml");
    const statePath = join(rootDir, ".quickenv/.quickenv.state");

    const config = await loadConfig(configPath);

    if (!config) {
      console.log(
        `${pc.yellow("⚠")}  quickenv is not initialized. Run ${pc.bold("quickenv init")}.`
      );
      process.exit(1);
    }

    const state = await loadState(statePath);
    const envResult = await resolveEnvQuickPath(statePath);

    // Active preset
    const presetLabel = state.activePreset
      ? pc.bold(state.activePreset)
      : pc.dim("(none)");

    const isProtected = state.activePreset
      ? !!config.presets[state.activePreset]?.protected
      : false;

    const protectedLabel = state.activePreset
      ? isProtected
        ? pc.yellow("yes")
        : "no"
      : pc.dim("—");

    // Source files
    const sourceLines: string[] = [];
    for (const p of envResult.paths) {
      const exists = await Bun.file(p).exists();
      if (exists) {
        sourceLines.push(pc.green(p));
      } else {
        sourceLines.push(`${pc.red(p)} ${pc.yellow("⚠ not found")}`);
      }
    }
    if (envResult.fallbackFrom) {
      sourceLines.push(
        pc.dim(`  (fallback from ${envResult.fallbackFrom})`)
      );
    }

    // Config & state files
    const stateExists = await Bun.file(statePath).exists();

    // Projects
    const projects = config.projects || [];

    // Available presets from .env.quick (merged across all source files)
    let presetNames: string[] = [];
    const anySourceExists = (
      await Promise.all(envResult.paths.map((p) => Bun.file(p).exists()))
    ).some(Boolean);
    if (anySourceExists) {
      try {
        const content = await loadMergedEnvQuick(envResult);
        const sections = parseEnvQuick(content);
        presetNames = getPresets(sections);
      } catch {
        // ignore parse errors
      }
    }

    // Render
    console.log();
    console.log(pc.bold("  quickenv status"));
    console.log();

    console.log(`  Active preset:   ${presetLabel}`);
    console.log(`  Protected:       ${protectedLabel}`);
    console.log();

    console.log(`  Source files:`);
    for (const line of sourceLines) {
      console.log(`    ${line}`);
    }
    if (envResult.isCustom) {
      console.log(pc.dim(`    (custom path)`));
    }
    console.log();

    console.log(
      `  Config:          ${pc.green("quickenv.yaml")}`
    );
    console.log(
      `  State:           ${stateExists ? pc.green(".quickenv/.quickenv.state") : pc.dim(".quickenv/.quickenv.state (not yet created)")}`
    );
    console.log();

    if (projects.length > 0) {
      console.log(`  Projects (${projects.length}):`);
      for (const proj of projects) {
        let path: string;
        let target = config.defaultTarget || ".env";

        if (typeof proj === "string") {
          path = proj;
        } else {
          path = proj.path;
          if (proj.target) target = proj.target;
        }

        console.log(`    ${pc.bold(path)}  → ${pc.dim(target)}`);
      }
    } else {
      console.log(`  Projects:        ${pc.dim("(none configured)")}`);
    }
    console.log();

    if (presetNames.length > 0) {
      const formatted = presetNames.map((name) => {
        const prot = config.presets[name]?.protected;
        const active = name === state.activePreset;
        let label = name;
        if (prot) label += pc.yellow(" 🔒");
        if (active) label = pc.bold(pc.green(label));
        return label;
      });
      console.log(`  Available presets: ${formatted.join(", ")}`);
    } else if (anySourceExists) {
      console.log(`  Available presets: ${pc.dim("(none found)")}`);
    } else {
      console.log(`  Available presets: ${pc.dim("(source file missing)")}`);
    }
    console.log();
  });
