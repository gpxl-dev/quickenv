/**
 * Serialization for generated .env files.
 *
 * Quoting targets the shared behavior of Bun's .env loader and dotenv-style
 * parsers: unquoted values are trimmed and truncated at `#`, single-quoted
 * values are fully literal, and double-quoted values expand only the `\n` and
 * `\r` escape sequences (neither parser unescapes `\"` or `\\`).
 */

const NEEDS_QUOTING = /[\n\r#"'`]/;

export function formatEnvValue(value: string): string {
  if (!NEEDS_QUOTING.test(value) && value === value.trim()) return value;

  // Single quotes are the safest wrapper: contents are read back literally.
  if (!/[\n\r']/.test(value)) return `'${value}'`;

  // Newlines and single quotes force double quotes. Inner double quotes are
  // escaped so the line still parses as one value, though parsers keep the
  // backslash — values combining newlines with double quotes cannot be
  // represented exactly for every dotenv parser.
  return `"${value
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")}"`;
}

export function serializeEnvFile(variables: Record<string, string>): string {
  const lines = Object.entries(variables).map(
    ([key, value]) => `${key}=${formatEnvValue(value)}`,
  );
  return lines.join("\n") + "\n";
}
