import { dirname, join, resolve } from "path";
import pc from "picocolors";

export interface QuickenvRootResult {
  startDir: string;
  rootDir: string;
  traversed: boolean;
}

async function hasQuickenvConfig(dir: string): Promise<boolean> {
  return await Bun.file(join(dir, "quickenv.yaml")).exists();
}

export async function findQuickenvRoot(startDir = process.cwd()): Promise<QuickenvRootResult | null> {
  let dir = resolve(startDir);

  while (true) {
    if (await hasQuickenvConfig(dir)) {
      return {
        startDir: resolve(startDir),
        rootDir: dir,
        traversed: dir !== resolve(startDir),
      };
    }

    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function useNearestQuickenvRoot(options: { noTraversal?: boolean } = {}): Promise<QuickenvRootResult | null> {
  const startDir = process.cwd();

  if (options.noTraversal) {
    return (await hasQuickenvConfig(startDir))
      ? { startDir, rootDir: startDir, traversed: false }
      : null;
  }

  const result = await findQuickenvRoot(startDir);
  if (result?.traversed) {
    console.warn(
      `${pc.yellow("quickenv:")} current directory is not a quickenv root; using nearest parent quickenv root:\n` +
        `  current: ${pc.dim(result.startDir)}\n` +
        `  root:    ${pc.bold(result.rootDir)}\n` +
        `  To disable parent traversal, run ${pc.bold("quickenv --no-traversal")} ...`
    );
    process.chdir(result.rootDir);
  }

  return result;
}
