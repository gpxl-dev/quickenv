import type { Config } from "./config";

export function maskValue(key: string, value: string, config: Config | null): string {
  if (!config?.variables) {
      return value;
  }
  
  const rules = config.variables[key];
  if (!rules?.sensitive && !rules?.revealPattern) {
    return value;
  }

  // Regex based masking
  if (rules.revealPattern) {
    try {
      const regex = new RegExp(rules.revealPattern);
      const match = value.match(regex);
      
      if (match) {
        const groupsToMask = rules.maskGroups || [1]; // Default to first capture group if not specified
        let result = value;
        
        // We sort groups in descending order to avoid offset issues during replacement
        const sortedGroups = [...groupsToMask].sort((a, b) => b - a);
        
        for (const groupIndex of sortedGroups) {
          const groupValue = match[groupIndex];
          if (groupValue !== undefined) {
            // Find the index of this specific capture group in the original string
            // Note: This is a simple implementation that finds the first occurrence.
            // For complex patterns with repeated identical groups, a more robust offset-based approach would be needed.
            const start = value.indexOf(groupValue);
            if (start !== -1) {
               result = result.substring(0, start) + "*".repeat(groupValue.length) + result.substring(start + groupValue.length);
            }
          }
        }
        return result;
      }
    } catch (e) {
      // If regex is invalid, fall back to default masking
    }
  }

  if (!rules?.sensitive) return value;

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
