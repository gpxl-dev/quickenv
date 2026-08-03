import YAML, { isMap } from "yaml";

export interface QuickEnvSection {
  tags: string[];
  variables: Record<string, string>;
}

export interface EnvQuickUpdate {
  preset: string;
  project?: string;
  variables: Record<string, string>;
}

export function getPresetNames(sections: QuickEnvSection[]): string[] {
  const presets = new Set<string>();
  for (const section of sections) {
    for (const tag of section.tags) {
      const separatorIndex = tag.lastIndexOf(":");
      presets.add(separatorIndex === -1 ? tag : tag.slice(separatorIndex + 1));
    }
  }
  return [...presets].filter(Boolean).sort((left, right) => left.localeCompare(right));
}

interface ProjectDefinition {
  sharedKeys: string[];
  sharedKeysDefined: boolean;
  variables: Record<string, string>;
}

interface PresetDefinition {
  common: Record<string, string>;
  shared: Record<string, string>;
  projects: Map<string, ProjectDefinition>;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalarToString(value: unknown, path: string): string {
  if (isRecord(value) || Array.isArray(value)) {
    throw new Error(`${path} must be a scalar value.`);
  }
  return String(value);
}

function parseVariables(value: unknown, path: string): Record<string, string> {
  if (!isRecord(value)) {
    throw new Error(`${path} must be a mapping of variable names to scalar values.`);
  }

  const variables: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    variables[key] = scalarToString(rawValue, `${path}.${key}`);
  }
  return variables;
}

function clonePreset(preset?: PresetDefinition): PresetDefinition {
  const projects = new Map<string, ProjectDefinition>();
  for (const [name, project] of preset?.projects ?? []) {
    projects.set(name, {
      sharedKeys: [...project.sharedKeys],
      sharedKeysDefined: project.sharedKeysDefined,
      variables: { ...project.variables },
    });
  }

  return {
    common: { ...preset?.common },
    shared: { ...preset?.shared },
    projects,
  };
}

function mergePreset(base: PresetDefinition, overlay: PresetDefinition): PresetDefinition {
  const merged = clonePreset(base);
  Object.assign(merged.common, overlay.common);
  Object.assign(merged.shared, overlay.shared);

  for (const [name, project] of overlay.projects) {
    const inherited = merged.projects.get(name);
    merged.projects.set(name, {
      sharedKeys: project.sharedKeysDefined
        ? [...project.sharedKeys]
        : [...(inherited?.sharedKeys ?? [])],
      sharedKeysDefined: project.sharedKeysDefined || (inherited?.sharedKeysDefined ?? false),
      variables: { ...inherited?.variables, ...project.variables },
    });
  }

  return merged;
}

function parseParentNames(
  value: unknown,
  presetName: string,
  presets: UnknownRecord,
): string[] {
  let parentNames: string[];
  if (typeof value === "string") {
    parentNames = value && value in presets
      ? [value]
      : value.split(",").map(name => name.trim());
  } else if (Array.isArray(value)) {
    if (value.some(name => typeof name !== "string")) {
      throw new Error(
        `Preset '${presetName}'.extends must be a preset name or a list of preset names.`,
      );
    }
    parentNames = value.map(name => name.trim());
  } else {
    throw new Error(
      `Preset '${presetName}'.extends must be a preset name or a list of preset names.`,
    );
  }

  if (parentNames.length === 0 || parentNames.some(name => !name)) {
    throw new Error(`Preset '${presetName}'.extends must name one or more presets.`);
  }
  return parentNames;
}

/** Parse the legacy tagged `.env.quick` format. */
export function parseEnvQuick(content: string): QuickEnvSection[] {
  const lines = content.split(/\r?\n/);
  const sections: QuickEnvSection[] = [];

  let currentTags: string[] = [];
  let currentVariables: Record<string, string> = {};

  const pushSection = () => {
    if (Object.keys(currentVariables).length > 0 || currentTags.length > 0) {
      sections.push({
        tags: currentTags,
        variables: currentVariables,
      });
    }
    currentVariables = {};
  };

  for (let line of lines) {
    line = line.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const headerMatch = line.match(/^\[(.*)\]$/);
    if (headerMatch) {
      if (currentTags.length > 0 || Object.keys(currentVariables).length > 0) {
        pushSection();
      }

      const tagContent = headerMatch[1] || "";
      currentTags = tagContent.split(",").map(tag => tag.trim()).filter(Boolean);
      continue;
    }

    const eqIndex = line.indexOf("=");
    if (eqIndex !== -1) {
      const key = line.substring(0, eqIndex).trim();
      const value = line.substring(eqIndex + 1).trim();
      currentVariables[key] = value;
    }
  }

  if (Object.keys(currentVariables).length > 0 || currentTags.length > 0) {
    pushSection();
  }

  return sections;
}

/**
 * Parse the preset-centric `.env.quick.yaml` format into the shared resolver model.
 * Presets inherit a complete definition. Shared imports are resolved after inheritance,
 * so an inherited `$shared` usage sees values overridden by a child preset.
 */
function parseYamlRoot(content: string): UnknownRecord {
  if (!content.trim()) return {};
  const raw = YAML.parse(content) as unknown;
  if (!isRecord(raw)) {
    throw new Error(".env.quick.yaml must contain a top-level mapping of presets.");
  }
  return raw;
}

function mergeYamlMappings(base: UnknownRecord, overlay: UnknownRecord): UnknownRecord {
  const merged: UnknownRecord = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const previous = merged[key];
    merged[key] = isRecord(previous) && isRecord(value)
      ? mergeYamlMappings(previous, value)
      : value;
  }
  return merged;
}

function parseEnvQuickYamlRoot(raw: UnknownRecord): QuickEnvSection[] {
  const resolved = new Map<string, PresetDefinition>();
  const resolving: string[] = [];

  const resolvePreset = (presetName: string): PresetDefinition => {
    const cached = resolved.get(presetName);
    if (cached) return cached;

    const cycleIndex = resolving.indexOf(presetName);
    if (cycleIndex !== -1) {
      const cycle = [...resolving.slice(cycleIndex), presetName].join(" -> ");
      throw new Error(`Preset inheritance cycle: ${cycle}.`);
    }

    const rawPresetValue = raw[presetName];
    const rawPreset = rawPresetValue === null ? {} : rawPresetValue;
    if (!isRecord(rawPreset)) {
      throw new Error(`Preset '${presetName}' must be a mapping.`);
    }

    resolving.push(presetName);
    try {
      let preset = clonePreset();
      const rawParents = rawPreset.extends;
      if (rawParents !== undefined) {
        for (const parentName of parseParentNames(rawParents, presetName, raw)) {
          if (!(parentName in raw)) {
            throw new Error(`Preset '${presetName}' extends unknown preset '${parentName}'.`);
          }
          preset = mergePreset(preset, resolvePreset(parentName));
        }
      }

      for (const [key, value] of Object.entries(rawPreset)) {
        if (key === "extends") continue;

        if (key === "shared") {
          Object.assign(preset.shared, parseVariables(value, `${presetName}.shared`));
          continue;
        }

        if (key === "*" || key === "all") {
          Object.assign(preset.common, parseVariables(value, `${presetName}.${key}`));
          continue;
        }

        if (!isRecord(value)) {
          throw new Error(`Project '${key}' in preset '${presetName}' must be a mapping.`);
        }

        const inherited = preset.projects.get(key);
        const project: ProjectDefinition = {
          sharedKeys: [...(inherited?.sharedKeys ?? [])],
          sharedKeysDefined: inherited?.sharedKeysDefined ?? false,
          variables: { ...inherited?.variables },
        };

        if ("$shared" in value) {
          const imports = value.$shared;
          if (!Array.isArray(imports) || imports.some(item => typeof item !== "string")) {
            throw new Error(`${presetName}.${key}.$shared must be a list of shared variable names.`);
          }
          project.sharedKeys = [...imports] as string[];
          project.sharedKeysDefined = true;
        }

        for (const [variableName, rawValue] of Object.entries(value)) {
          if (variableName === "$shared") continue;
          project.variables[variableName] = scalarToString(
            rawValue,
            `${presetName}.${key}.${variableName}`,
          );
        }

        preset.projects.set(key, project);
      }

      resolved.set(presetName, preset);
      return preset;
    } finally {
      resolving.pop();
    }
  };

  const sections: QuickEnvSection[] = [];
  for (const presetName of Object.keys(raw)) {
    const preset = resolvePreset(presetName);

    // Keep every top-level key selectable, even when the preset has no common values.
    sections.push({ tags: [presetName], variables: { ...preset.common } });

    for (const [projectName, project] of preset.projects) {
      const variables: Record<string, string> = {};
      for (const sharedKey of project.sharedKeys) {
        if (!(sharedKey in preset.shared)) {
          throw new Error(
            `Project '${projectName}' in preset '${presetName}' imports unknown shared variable '${sharedKey}'.`,
          );
        }
        variables[sharedKey] = preset.shared[sharedKey]!;
      }
      Object.assign(variables, project.variables);
      sections.push({ tags: [`${projectName}:${presetName}`], variables });
    }
  }

  return sections;
}

export function parseEnvQuickYaml(content: string): QuickEnvSection[] {
  return parseEnvQuickYamlRoot(parseYamlRoot(content));
}

/** Parse ordered YAML overlays before resolving inheritance and shared imports. */
export function parseEnvQuickYamlSources(contents: string[]): QuickEnvSection[] {
  let merged: UnknownRecord = {};
  for (const content of contents) {
    merged = mergeYamlMappings(merged, parseYamlRoot(content));
  }
  return parseEnvQuickYamlRoot(merged);
}

export function isEnvQuickYamlPath(path: string): boolean {
  return /\.ya?ml$/i.test(path);
}

export function getYamlPresetNames(content: string): string[] {
  return Object.keys(parseYamlRoot(content)).sort((left, right) =>
    left.localeCompare(right),
  );
}

export function createYamlPresetContent(
  content: string,
  presetName: string,
  parentPreset?: string,
): string {
  const name = presetName.trim();
  if (!name) throw new Error("Preset name cannot be empty.");

  const document = YAML.parseDocument(content.trim() ? content : "{}");
  if (document.errors.length > 0) throw document.errors[0];
  if (!isMap(document.contents)) {
    throw new Error(".env.quick.yaml must contain a top-level mapping of presets.");
  }
  if (document.has(name)) {
    throw new Error(`Preset '${name}' already exists.`);
  }

  document.set(name, document.createNode(parentPreset ? { extends: parentPreset } : {}));
  return document.toString();
}

export function parseEnvQuickSource(content: string, path: string): QuickEnvSection[] {
  return isEnvQuickYamlPath(path) ? parseEnvQuickYaml(content) : parseEnvQuick(content);
}

export function serializeEnvQuick(sections: QuickEnvSection[]): string {
  const lines: string[] = [];

  for (const section of sections) {
    if (section.tags.length > 0) {
      lines.push(`[${section.tags.join(", ")}]`);
    }

    for (const [key, value] of Object.entries(section.variables)) {
      lines.push(`${key}=${value}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

function updateLegacyContent(
  content: string,
  updates: EnvQuickUpdate[],
  onlyIfMissing: boolean,
): string {
  const sections = parseEnvQuick(content);
  let changed = false;

  for (const update of updates) {
    const tag = update.project ? `${update.project}:${update.preset}` : update.preset;
    let section = sections.find(candidate => candidate.tags.length === 1 && candidate.tags[0] === tag);
    if (!section) {
      section = { tags: [tag], variables: {} };
      sections.push(section);
    }

    for (const [key, value] of Object.entries(update.variables)) {
      if (!onlyIfMissing || !(key in section.variables)) {
        if (section.variables[key] !== value) changed = true;
        section.variables[key] = value;
      }
    }
  }

  return changed ? serializeEnvQuick(sections) : content;
}

function updateYamlContent(
  content: string,
  updates: EnvQuickUpdate[],
  onlyIfMissing: boolean,
  mergedEffectiveSections?: QuickEnvSection[],
): string {
  const document = YAML.parseDocument(content.trim() ? content : "{}");
  if (document.errors.length > 0) {
    throw document.errors[0];
  }
  const effectiveSections = onlyIfMissing
    ? mergedEffectiveSections ?? parseEnvQuickYaml(content)
    : [];
  let changed = false;

  const isEffectivelyDefined = (update: EnvQuickUpdate, key: string): boolean => {
    const commonTag = update.preset;
    const projectTag = update.project ? `${update.project}:${update.preset}` : undefined;
    return effectiveSections.some(section =>
      (section.tags[0] === commonTag || section.tags[0] === projectTag)
      && key in section.variables
    );
  };

  for (const update of updates) {
    const entries = Object.entries(update.variables).filter(([key]) =>
      !onlyIfMissing || !isEffectivelyDefined(update, key)
    );
    if (entries.length === 0) continue;

    const presetValue = document.getIn([update.preset]);
    const presetNode = document.getIn([update.preset], true);
    if (presetValue === null || presetValue === undefined) {
      document.delete(update.preset);
      document.set(update.preset, document.createNode({}));
    } else if (!isMap(presetNode)) {
      throw new Error(`Preset '${update.preset}' must be a mapping.`);
    }

    let scopes: string[];
    if (update.project) {
      scopes = [update.project];
    } else {
      scopes = ["*", "all"].filter(scope => document.hasIn([update.preset, scope]));
      if (scopes.length === 0) scopes = ["*"];
    }

    for (const [key, value] of entries) {
      // When both aliases exist, keep direct persistent writes consistent in both.
      const targetScopes = onlyIfMissing ? [scopes[scopes.length - 1]!] : scopes;
      for (const scope of targetScopes) {
        const path = [update.preset, scope, key];
        if (document.getIn(path) !== value) changed = true;
        document.setIn(path, value);
      }
    }
  }

  return changed ? document.toString() : content;
}

/** Structurally update either source format without corrupting YAML files. */
export function updateEnvQuickContent(
  content: string,
  path: string,
  updates: EnvQuickUpdate[],
  options: {
    onlyIfMissing?: boolean;
    mergedEffectiveSections?: QuickEnvSection[];
  } = {},
): string {
  const onlyIfMissing = options.onlyIfMissing ?? false;
  return isEnvQuickYamlPath(path)
    ? updateYamlContent(content, updates, onlyIfMissing, options.mergedEffectiveSections)
    : updateLegacyContent(content, updates, onlyIfMissing);
}
