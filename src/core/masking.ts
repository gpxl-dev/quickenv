import type { Config } from "./config";

const DEFAULT_MASKED_CAPTURE_GROUPS = [1];

function replaceCaptureGroups(value: string, match: RegExpMatchArray, groupsToMask: number[]): string {
  return [...groupsToMask]
    .sort((a, b) => b - a)
    .reduce((result, groupIndex) => {
      const groupValue = match[groupIndex];
      if (groupValue === undefined) return result;

      // This intentionally preserves the existing behavior of masking the first
      // occurrence of a captured value. For repeated identical captures, callers
      // can use a more specific revealPattern to disambiguate.
      const start = value.indexOf(groupValue);
      if (start === -1) return result;

      return result.substring(0, start) + "*".repeat(groupValue.length) + result.substring(start + groupValue.length);
    }, value);
}

function maskWithRevealPattern(value: string, revealPattern: string, maskGroups?: number[]): string | null {
  try {
    const match = value.match(new RegExp(revealPattern));
    if (!match) return null;

    return replaceCaptureGroups(value, match, maskGroups ?? DEFAULT_MASKED_CAPTURE_GROUPS);
  } catch {
    return null;
  }
}

function maskSensitiveValue(value: string): string {
  const len = value.length;

  if (len <= 4) return "*".repeat(len);
  if (len > 16) return value.substring(0, 4) + "*".repeat(8) + value.substring(len - 4);

  return value.substring(0, 2) + "*".repeat(len - 4) + value.substring(len - 2);
}

export function maskValue(key: string, value: string, config: Config | null): string {
  const rules = config?.variables[key];
  if (!rules?.sensitive && !rules?.revealPattern) return value;

  if (rules.revealPattern) {
    const masked = maskWithRevealPattern(value, rules.revealPattern, rules.maskGroups);
    if (masked !== null) return masked;
  }

  return rules.sensitive ? maskSensitiveValue(value) : value;
}
