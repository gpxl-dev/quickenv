# Legacy `.env.quick` format

The INI-like `.env.quick` format is retained for compatibility. New configurations should use the preset-based [`.env.quick.yaml` format](README.md#preset-source-envquickyaml).

At the default source location, `.quickenv/.env.quick.yaml` takes precedence over `.quickenv/.env.quick`. quickenv reads the legacy file as a fallback when the preferred YAML file is not available.

## File format

Legacy files contain `KEY=value` entries and optional tag sections:

```ini
# Untagged variables apply everywhere
NODE_ENV=development

[local]
API_URL=http://localhost:3000
DEBUG=true

[production]
API_URL=https://api.example.com
# An empty value removes the variable
DEBUG=

[apps/api]
API_PORT=3000

[apps/api:local]
DATABASE_URL=postgres://localhost:5432/api
```

A section can carry more than one tag. The variables then participate in each named preset or project:

```ini
[local, preview]
NODE_ENV=development
```

Only lines that start with `#` are comments. Put explanatory comments on their own lines rather than after a value.

## Tags

Legacy tags can identify:

- a preset, such as `[local]`
- a project, such as `[apps/api]`
- a project and preset, such as `[apps/api:local]`
- all projects for one preset, such as `[*:local]`
- one project for all presets, such as `[apps/api:*]`

Project segments also support glob patterns:

```ini
[apps/web-*:local]
PUBLIC_API_URL=http://localhost:3000

[packages/**]
LOG_LEVEL=debug
```

## Resolution behavior

For a selected preset and project, matching values apply in this order, from lowest to highest precedence:

1. global untagged values
2. project-only tags, including matching project globs
3. preset tags
4. wildcard combinations such as `[*:local]`, `[apps/api:*]`, or a matching project glob with `:*`
5. project-and-preset combinations, including matching project globs

Within one layer, later matching sections can replace values from earlier matching sections.

An empty value or the exact value `UNSET` removes a variable at the layer where it appears:

```ini
[production]
DEBUG=
LOCAL_ONLY_TOKEN=UNSET
```

## Multiple legacy source files

`.quickenv/.quickenv.state` can set `envPath` to one legacy file or an ordered list of legacy files:

```json
{
  "activePreset": "local",
  "envPath": ["../shared/.quickenv/.env.quick", ".quickenv/.env.quick"]
}
```

Later files override earlier files for the same tag and variable. See [Multiple source files](README.md#multiple-source-files) for current source selection guidance.
