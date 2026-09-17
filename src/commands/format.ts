import { Command } from "commander";
import { resolveEnvQuickPath } from "../core/config";
import { writePrivateFileAtomic } from "../core/files";
import { formatEnvQuickYaml, isEnvQuickYamlPath } from "../core/parser";

export const formatCommand = new Command("format")
  .description("Formats active YAML sources using block-style collections")
  .action(async () => {
    const envResult = await resolveEnvQuickPath();
    let formattedCount = 0;

    for (const path of envResult.paths) {
      if (!isEnvQuickYamlPath(path)) continue;

      const source = await Bun.file(path).text();
      const formatted = formatEnvQuickYaml(source);
      if (formatted === source) continue;

      await writePrivateFileAtomic(path, formatted);
      formattedCount += 1;
      console.log(`Formatted ${path}`);
    }

    if (formattedCount === 0) {
      console.log("All active YAML sources are already formatted.");
    }
  });
