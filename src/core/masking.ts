import type { Config } from "./config";

export function maskValue(key: string, value: string, config: Config | null): string {
  if (!config?.variables) {
      return value;
  }
  
  const rules = config.variables[key];
  if (!rules?.sensitive) {
    return value;
  }

  // TODO: Implement regex based masking
  // if (rules.revealPattern && rules.maskGroups) { ... }

  const len = value.length;
  if (len > 16) {
    return value.substring(0, 4) + "*".repeat(8) + value.substring(len - 4);
  } else {
    // If very short, we might mask everything or leave 1 char?
    // "first/last 2". If len=3, first 2 is 0..2, last 2 is 1..3. Overlap.
    // If len <= 4, mask all?
    if (len <= 4) return "*".repeat(len);
    return value.substring(0, 2) + "*".repeat(Math.max(0, len - 4)) + value.substring(len - 2);
  }
}
